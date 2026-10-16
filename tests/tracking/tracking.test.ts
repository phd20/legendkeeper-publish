import { describe, expect, it } from "vitest";
import { emptyManifest, loadManifest, rekeyManifest, type Manifest, type ManifestEntry } from "../../src/tracking/manifest";
import { scanTargets, type VaultNote } from "../../src/tracking/scan";
import { planChanges, type PlannedTarget } from "../../src/tracking/planner";
import { SignatureCache, conversionSignature } from "../../src/tracking/cache";
import { estimateUnpublished } from "../../src/tracking/estimate";

const note = (path: string, extra: Partial<VaultNote> = {}): VaultNote => ({
  path,
  mtime: 100,
  size: 10,
  excluded: false,
  ...extra,
});

const entry = (extra: Partial<ManifestEntry> = {}): ManifestEntry => ({
  kind: "note",
  resourceId: "res00001",
  hash: "h1",
  blocksHash: "b1",
  parentKey: null,
  publishedAt: 200,
  ...extra,
});

const manifestWith = (entries: Record<string, ManifestEntry>): Manifest => ({ ...emptyManifest("p", "m"), entries });

const planned = (key: string, extra: Partial<PlannedTarget> = {}): PlannedTarget => ({
  fields: { name: key, tags: [], aliases: [], isHidden: false },
  key,
  kind: "note",
  name: key,
  parentKey: null,
  contentPath: key,
  hash: "h1",
  blocksHash: "b1",
  ...extra,
});

describe("scanTargets", () => {
  it("includes every note by default and creates folders for publishable descendants", () => {
    const targets = scanTargets([note("Home.md"), note("Places/Keep.md"), note("Places/Cities/Oakhaven.md")]);
    expect(targets.map((t) => [t.kind, t.key, t.parentKey])).toEqual([
      ["folder", "Places", null],
      ["note", "Home.md", null],
      ["folder", "Places/Cities", "Places"],
      ["note", "Places/Keep.md", "Places"],
      ["note", "Places/Cities/Oakhaven.md", "Places/Cities"],
    ]);
  });

  it("excludes notes with the exclusion flag", () => {
    const targets = scanTargets([note("A.md"), note("Secret.md", { excluded: true })]);
    expect(targets.map((t) => t.key)).toEqual(["A.md"]);
  });

  it("does not create a folder when every note beneath it is excluded", () => {
    const targets = scanTargets([note("Drafts/One.md", { excluded: true }), note("Home.md")]);
    expect(targets.map((t) => t.key)).toEqual(["Home.md"]);
  });

  it("uses a folder note as the folder's page and does not publish it separately", () => {
    const targets = scanTargets([note("Lore/Lore.md"), note("Lore/Gods.md")]);
    expect(targets.find((t) => t.key === "Lore")).toMatchObject({ kind: "folder", contentPath: "Lore/Lore.md" });
    expect(targets.map((t) => t.key)).toEqual(["Lore", "Lore/Gods.md"]);
  });

  it("keeps the folder with an auto page when only its folder note is excluded", () => {
    const targets = scanTargets([note("Lore/Lore.md", { excluded: true }), note("Lore/Gods.md")]);
    expect(targets.find((t) => t.key === "Lore")).toMatchObject({ contentPath: null });
    expect(targets.map((t) => t.key)).toEqual(["Lore", "Lore/Gods.md"]);
  });

  it("drops a folder whose only publishable content was an excluded folder note", () => {
    expect(scanTargets([note("Lore/Lore.md", { excluded: true })])).toEqual([]);
  });

  it("sorts folders before notes, then alphabetically", () => {
    const targets = scanTargets([note("Zeta.md"), note("Alpha.md"), note("Beta/X.md")]);
    expect(targets.filter((t) => t.parentKey === null).map((t) => t.key)).toEqual(["Beta", "Alpha.md", "Zeta.md"]);
  });
});

describe("planChanges", () => {
  it("classifies new notes and new folders (required parents)", () => {
    const items = planChanges(
      [planned("Places", { kind: "folder", contentPath: null }), planned("Places/Keep.md", { parentKey: "Places" })],
      emptyManifest(),
    );
    expect(items.map((i) => [i.type, i.key])).toEqual([
      ["required", "Places"],
      ["new", "Places/Keep.md"],
    ]);
  });

  it("treats a new folder that has its own folder note as a normal New item, not a pure parent", () => {
    const items = planChanges(
      [planned("Lore", { kind: "folder", contentPath: "Lore/Lore.md" }), planned("Places", { kind: "folder", contentPath: null })],
      emptyManifest(),
    );
    expect(items.map((i) => [i.key, i.type])).toEqual([
      ["Lore", "new"],
      ["Places", "required"],
    ]);
  });

  it("lists nothing for unchanged items", () => {
    expect(planChanges([planned("A.md")], manifestWith({ "A.md": entry() }))).toEqual([]);
  });

  it("whitespace-only edits leave the hash equal and so are not Changed", () => {
    // Same output hash => no item, regardless of how the source text differed.
    expect(planChanges([planned("A.md", { hash: "h1" })], manifestWith({ "A.md": entry({ hash: "h1" }) }))).toEqual([]);
  });

  it("flags Changed when the output hash differs", () => {
    const items = planChanges([planned("A.md", { hash: "h2" })], manifestWith({ "A.md": entry() }));
    expect(items.map((i) => i.type)).toEqual(["changed"]);
  });

  it("classifies a changed parent folder as Moved and records whether content also changed", () => {
    const items = planChanges(
      [planned("Ruins/Keep.md", { parentKey: "Ruins" })],
      manifestWith({ "Ruins/Keep.md": entry({ parentKey: "Places" }) }),
    );
    expect(items[0]).toMatchObject({ type: "moved", contentChanged: false });
  });

  it("classifies manifest entries without a target as Deleted", () => {
    const items = planChanges([], manifestWith({ "Gone.md": entry() }));
    expect(items.map((i) => [i.type, i.key, i.name])).toEqual([["deleted", "Gone.md", "Gone"]]);
  });

  it("a note that becomes excluded is Deleted", () => {
    const targets = scanTargets([note("A.md", { excluded: true })]).map((t) => planned(t.key));
    expect(planChanges(targets, manifestWith({ "A.md": entry() })).map((i) => i.type)).toEqual(["deleted"]);
  });

  it("pairs one deleted and one new note with identical content as a probable move", () => {
    const items = planChanges(
      [planned("The Keep.md", { hash: "h9", blocksHash: "same" })],
      manifestWith({ "Keep.md": entry({ blocksHash: "same" }) }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "moved", key: "The Keep.md", previousKey: "Keep.md", probable: true });
  });

  it("does not guess when several notes share the same content, or the page is empty", () => {
    const ambiguous = planChanges(
      [planned("A2.md", { blocksHash: "same" }), planned("B2.md", { blocksHash: "same" })],
      manifestWith({ "A.md": entry({ blocksHash: "same" }) }),
    );
    expect(ambiguous.map((i) => i.type).sort()).toEqual(["deleted", "new", "new"]);
    const empty = planChanges([planned("N.md", { blocksHash: "" })], manifestWith({ "O.md": entry({ blocksHash: "" }) }));
    expect(empty.map((i) => i.type).sort()).toEqual(["deleted", "new"]);
  });
});

describe("rekeyManifest", () => {
  it("moves a renamed note's entry and preserves its resource id", () => {
    const m = rekeyManifest(manifestWith({ "Places/Keep.md": entry({ parentKey: "Places" }) }), "Places/Keep.md", "Places/The Keep.md");
    expect(Object.keys(m.entries)).toEqual(["Places/The Keep.md"]);
    expect(m.entries["Places/The Keep.md"].resourceId).toBe("res00001");
  });

  it("re-keys a renamed folder, its descendants, and their parentKey", () => {
    const m = rekeyManifest(
      manifestWith({
        Places: entry({ kind: "folder", resourceId: "fold0001" }),
        "Places/Keep.md": entry({ parentKey: "Places" }),
        "Places/Cities": entry({ kind: "folder", resourceId: "fold0002", parentKey: "Places" }),
        "Places/Cities/Oak.md": entry({ parentKey: "Places/Cities" }),
        "Placesmat.md": entry({ resourceId: "other001" }),
      }),
      "Places",
      "World",
    );
    expect(Object.keys(m.entries).sort()).toEqual(["Placesmat.md", "World", "World/Cities", "World/Cities/Oak.md", "World/Keep.md"]);
    expect(m.entries["World/Keep.md"].parentKey).toBe("World");
    expect(m.entries["World/Cities/Oak.md"].parentKey).toBe("World/Cities");
    expect(m.entries["Placesmat.md"].resourceId).toBe("other001");
  });
});

describe("loadManifest", () => {
  it("returns an empty manifest for malformed data", () => {
    expect(loadManifest(null)).toEqual(emptyManifest());
    expect(loadManifest({ version: 2 })).toEqual(emptyManifest());
  });
  it("round-trips a valid manifest", () => {
    const m = manifestWith({ "A.md": entry() });
    expect(loadManifest(JSON.parse(JSON.stringify(m)))).toEqual({ ...m, assetFolderId: undefined });
  });
});

describe("SignatureCache", () => {
  it("reuses a value while the signature matches and recomputes when it changes", () => {
    const cache = new SignatureCache<number>();
    const sig = conversionSignature({ mtime: 1, size: 2, settingsHash: "s", linkTargetsHash: "l" });
    cache.set("A.md", sig, 42);
    expect(cache.get("A.md", sig)).toBe(42);
    expect(cache.get("A.md", conversionSignature({ mtime: 2, size: 2, settingsHash: "s", linkTargetsHash: "l" }))).toBeUndefined();
    expect(cache.get("A.md", conversionSignature({ mtime: 1, size: 2, settingsHash: "s", linkTargetsHash: "other" }))).toBeUndefined();
  });
});

describe("estimateUnpublished", () => {
  it("counts new, modified-since-publish, and deleted items", () => {
    const manifest = manifestWith({
      "Synced.md": entry({ publishedAt: 500 }),
      "Edited.md": entry({ publishedAt: 50 }),
      "Gone.md": entry(),
    });
    const notes = [note("Synced.md"), note("Edited.md", { mtime: 100 }), note("Brand New.md")];
    expect(estimateUnpublished(notes, manifest)).toBe(3);
  });

  it("counts a resource whose page write never finished", () => {
    const manifest = manifestWith({ "A.md": entry({ hash: "", publishedAt: 500 }) });
    expect(estimateUnpublished([note("A.md")], manifest)).toBe(1);
  });

  it("is zero when everything is up to date", () => {
    expect(estimateUnpublished([note("A.md")], manifestWith({ "A.md": entry({ publishedAt: 500 }) }))).toBe(0);
  });
});
