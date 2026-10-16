import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadPluginData, setupMessage, setupProblems, targetChanged } from "../../src/settings/data";
import { defaultSelection, filterToNote, groupOf, isLocked, selectedRun, setChecked, setGroup } from "../../src/review/selection";
import { emptyManifest } from "../../src/tracking/manifest";
import type { PlanItem, PlannedTarget } from "../../src/tracking/planner";

const target = (key: string, parentKey: string | null): PlannedTarget => ({
  key,
  kind: key.endsWith(".md") ? "note" : "folder",
  name: key,
  parentKey,
  contentPath: key,
  hash: "h",
  blocksHash: "b",
  fields: { name: key, tags: [], aliases: [], isHidden: false },
});

const it_ = (type: PlanItem["type"], key: string, parentKey: string | null = null, extra: Partial<PlanItem> = {}): PlanItem => ({
  type,
  key,
  kind: key.endsWith(".md") ? "note" : "folder",
  name: key,
  target: type === "deleted" ? undefined : target(key, parentKey),
  ...extra,
});

describe("default selection", () => {
  const items = [
    it_("required", "Factions"),
    it_("new", "Factions/Guild.md", "Factions"),
    it_("changed", "A.md"),
    it_("deleted", "Gone.md"),
    it_("changed", "B.md", null, { editedInLk: true }),
  ];

  it("checks New/Changed/Moved, leaves Deleted and Edited-in-LegendKeeper unchecked", () => {
    const sel = defaultSelection(items);
    expect([...sel].sort()).toEqual(["A.md", "Factions", "Factions/Guild.md"]);
    expect(groupOf(items[4])).toBe("edited");
  });
});

describe("required parents", () => {
  const items = [
    it_("required", "Places"),
    it_("required", "Places/Cities", "Places"),
    it_("new", "Places/Cities/Oak.md", "Places/Cities"),
    it_("new", "Places/Keep.md", "Places"),
  ];

  it("selects every required ancestor of a selected note and locks them", () => {
    const sel = setChecked(items, new Set(), "Places/Cities/Oak.md", true);
    expect([...sel].sort()).toEqual(["Places", "Places/Cities", "Places/Cities/Oak.md"]);
    expect(isLocked(items[0], items, sel)).toBe(true);
    expect(isLocked(items[1], items, sel)).toBe(true);
    expect(isLocked(items[2], items, sel)).toBe(false);
  });

  it("unchecks a required parent when its last selected descendant is unchecked", () => {
    let sel = defaultSelection(items);
    sel = setChecked(items, sel, "Places/Cities/Oak.md", false);
    expect(sel.has("Places/Cities")).toBe(false);
    expect(sel.has("Places")).toBe(true); // Keep.md still needs it
    sel = setChecked(items, sel, "Places/Keep.md", false);
    expect(sel.size).toBe(0);
  });

  it("does not let a required parent be selected on its own", () => {
    expect(setChecked(items, new Set(), "Places", true).size).toBe(0);
  });
});

describe("run selection", () => {
  it("returns selected items in plan order and the overwrite set", () => {
    const items = [it_("changed", "A.md"), it_("changed", "B.md", null, { editedInLk: true }), it_("deleted", "C.md")];
    const sel = setGroup(items, new Set(["A.md"]), "edited", true);
    const run = selectedRun(items, sel);
    expect(run.items.map((i) => i.key)).toEqual(["A.md", "B.md"]);
    expect([...run.overwrite]).toEqual(["B.md"]);
  });

  it("supports select-all and select-none per group", () => {
    const items = [it_("deleted", "A.md"), it_("deleted", "B.md"), it_("new", "N.md")];
    expect(setGroup(items, new Set(), "deleted", true).size).toBe(2);
    expect(setGroup(items, new Set(["A.md", "B.md", "N.md"]), "deleted", false)).toEqual(new Set(["N.md"]));
  });

  it("filters to one note plus the new folders it needs", () => {
    const items = [
      it_("required", "Places"),
      it_("new", "Places/Keep.md", "Places"),
      it_("new", "Places/Other.md", "Places"),
      it_("changed", "A.md"),
    ];
    expect(filterToNote(items, "Places/Keep.md").map((i) => i.key)).toEqual(["Places", "Places/Keep.md"]);
    expect(filterToNote(items, "Missing.md")).toEqual([]);
  });
});

describe("settings data", () => {
  it("fills defaults and ignores wrongly-typed stored values", () => {
    const { settings, manifest } = loadPluginData({ settings: { excludeKey: "lk-publish", hiddenByDefault: "yes", hiddenKey: "  " } });
    expect(settings.excludeKey).toBe("lk-publish");
    expect(settings.hiddenByDefault).toBe(false);
    expect(settings.hiddenKey).toBe(DEFAULT_SETTINGS.hiddenKey);
    expect(manifest.entries).toEqual({});
  });

  it("gates publishing on key, project and mount point", () => {
    expect(setupProblems(DEFAULT_SETTINGS, null)).toEqual(["key", "project", "mount"]);
    const ready = { ...DEFAULT_SETTINGS, secretName: "lk", projectId: "p", mountId: "m" };
    expect(setupProblems(ready, "secret")).toEqual([]);
    expect(setupProblems(ready, null)).toEqual(["key"]);
    expect(setupMessage(["key", "mount"])).toMatch(/API key.*mount point/);
  });

  it("warns about changing the target only when something is already published", () => {
    const empty = emptyManifest("p", "m");
    expect(targetChanged(empty, { projectId: "p", mountId: "other" })).toBe(false);
    const used = { ...empty, entries: { "A.md": { kind: "note" as const, resourceId: "r", hash: "h", blocksHash: "b", parentKey: null, publishedAt: 1 } } };
    expect(targetChanged(used, { projectId: "p", mountId: "other" })).toBe(true);
    expect(targetChanged(used, { projectId: "p", mountId: "m" })).toBe(false);
  });
});
