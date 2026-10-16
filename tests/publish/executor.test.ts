import { describe, expect, it } from "vitest";
import { executePublish, type ConvertRequest, type ConvertedTarget, type ExecutorDeps } from "../../src/publish/executor";
import { emptyManifest, type Manifest, type ManifestEntry } from "../../src/tracking/manifest";
import type { PlanItem, PlannedTarget } from "../../src/tracking/planner";
import { PENDING_ASSET_PREFIX, type Block } from "../../src/convert/types";
import { isValidResourceId } from "../../src/lk/ids";
import type { CreateResourceSpec, LkApi } from "../../src/lk/api";

class FakeError extends Error {
  constructor(public status: number, public code: string, message = code, public requestId = "req-1") {
    super(message);
  }
}

class FakeApi implements LkApi {
  calls: string[] = [];
  createBatches: CreateResourceSpec[][] = [];
  idempotencyKeys: string[] = [];
  resources = new Map<string, { id: string; name: string; parentId: string; docId: string; version: number; hidden: boolean }>();
  uploads: string[] = [];
  folderRequests: string[] = [];
  pages = new Map<string, Block[]>();
  ifMatches: Array<string | undefined> = [];
  moved: Array<[string, string]> = [];
  deleted: Array<[string, boolean]> = [];
  failCreate?: (spec: CreateResourceSpec) => FakeError | undefined;
  failReplace?: (resourceId: string) => FakeError | undefined;
  failDelete?: (id: string, cascade: boolean) => FakeError | undefined;
  onCall?: (name: string) => void;
  private n = 0;

  private log(name: string) {
    this.calls.push(name);
    this.onCall?.(name);
  }
  async project() {
    return { id: "proj", name: "Proj" };
  }
  async listTopLevelResources() {
    return [];
  }
  async createResources(specs: CreateResourceSpec[], key: string) {
    this.log("create");
    this.createBatches.push(specs);
    this.idempotencyKeys.push(key);
    for (const spec of specs) {
      const err = this.failCreate?.(spec);
      if (err) throw err;
    }
    return specs.map((spec) => {
      const docId = `doc${++this.n}`;
      this.resources.set(spec.id, { id: spec.id, name: spec.name, parentId: spec.parentId ?? "", docId, version: 0, hidden: !!spec.isHidden });
      return { id: spec.id, documentId: docId };
    });
  }
  async updateResource(id: string) {
    this.log("update");
    void id;
  }
  async moveResource(id: string, parentId: string) {
    this.log("move");
    this.moved.push([id, parentId]);
  }
  async deleteResource(id: string, cascade: boolean) {
    this.log("delete");
    this.deleted.push([id, cascade]);
    const err = this.failDelete?.(id, cascade);
    if (err) throw err;
  }
  async getMainDocumentId(resourceId: string) {
    return this.resources.get(resourceId)?.docId ?? "docX";
  }
  async getPageVersion() {
    return "v";
  }
  async replacePage(resourceId: string, _doc: string, blocks: Block[], ifMatch?: string) {
    this.log("replace");
    this.ifMatches.push(ifMatch);
    const err = this.failReplace?.(resourceId);
    if (err) throw err;
    this.pages.set(resourceId, blocks);
    const r = this.resources.get(resourceId);
    const version = (r ? ++r.version : 1);
    return { version: `v${version}` };
  }
  async ensureAssetFolder(name: string) {
    this.log("folder");
    this.folderRequests.push(name);
    return "folder1";
  }
  async uploadImage(input: { name: string }) {
    this.log("upload");
    this.uploads.push(input.name);
    return { id: `asset-${input.name}`, url: `https://assets/${input.name}` };
  }
}

const target = (key: string, extra: Partial<PlannedTarget> = {}): PlannedTarget => ({
  key,
  kind: "note",
  name: key.replace(/\.md$/, "").split("/").pop()!,
  parentKey: key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : null,
  contentPath: key,
  hash: "h",
  blocksHash: "b",
  fields: { name: key.replace(/\.md$/, "").split("/").pop()!, tags: [], aliases: [], isHidden: false },
  ...extra,
});

const folder = (key: string): PlannedTarget => target(key, { kind: "folder", contentPath: null });
const item = (type: PlanItem["type"], t: PlannedTarget, extra: Partial<PlanItem> = {}): PlanItem => ({
  type,
  key: t.key,
  kind: t.kind,
  name: t.name,
  target: t,
  ...extra,
});

function setup(opts: { manifest?: Manifest; convert?: ExecutorDeps["convert"]; signal?: AbortSignal } = {}) {
  const api = new FakeApi();
  const manifest = opts.manifest ?? emptyManifest("proj", "mount001");
  const progress: Array<[number, number]> = [];
  const saves: boolean[] = [];
  const deps: ExecutorDeps = {
    api,
    manifest,
    vaultName: "My Vault",
    convert:
      opts.convert ??
      (async (req: ConvertRequest): Promise<ConvertedTarget> => ({
        fields: { ...(req.target as PlannedTarget).fields, parentId: req.parentId },
        blocks: [{ kind: "paragraph", content: [{ text: req.target.name }] } as unknown as Block],
        hash: `hash-${req.target.key}`,
        blocksHash: `blocks-${req.target.key}`,
        warnings: [],
      })),
    readAsset: async (hash) => ({ data: new Uint8Array([1, 2, 3]), contentType: "image/png", name: `${hash}.png` }),
    saveManifest: async (flush) => void saves.push(flush),
    confirmCascade: async () => "skip",
    onProgress: (d, t) => progress.push([d, t]),
    signal: opts.signal,
    now: () => 1234,
  };
  return { api, manifest, deps, progress, saves };
}

const entry = (extra: Partial<ManifestEntry> = {}): ManifestEntry => ({
  kind: "note",
  resourceId: "existing1",
  documentId: "docE",
  hash: "old",
  blocksHash: "oldb",
  parentKey: null,
  docVersion: "v7",
  publishedAt: 1,
  ...extra,
});

describe("creation", () => {
  it("creates a new note with a minted valid id and records it in the manifest", async () => {
    const { api, manifest, deps } = setup();
    const summary = await executePublish([item("new", target("Aldric.md"))], deps);
    expect(summary).toMatchObject({ published: ["Aldric.md"], failed: [], skipped: [], cancelled: false });
    const spec = api.createBatches[0][0];
    expect(isValidResourceId(spec.id)).toBe(true);
    expect(spec.parentId).toBe("mount001");
    expect(manifest.entries["Aldric.md"]).toMatchObject({
      resourceId: spec.id,
      hash: "hash-Aldric.md",
      blocksHash: "blocks-Aldric.md",
      docVersion: "v1",
      publishedAt: 1234,
      parentKey: null,
    });
  });

  it("creates a folder before the note inside it and parents the note to the folder's id", async () => {
    const { api, manifest, deps } = setup();
    // Deliberately supplied children-first.
    await executePublish(
      [item("new", target("Places/Keep.md")), item("required", folder("Places"))],
      deps,
    );
    const [first, second] = api.createBatches[0];
    expect(first.name).toBe("Places");
    expect(second.parentId).toBe(first.id);
    expect(manifest.entries["Places/Keep.md"].parentKey).toBe("Places");
  });

  it("submits siblings in the order given and sends an idempotency key per chunk", async () => {
    const { api, deps } = setup();
    await executePublish([item("new", target("Alpha.md")), item("new", target("Zeta.md"))], deps);
    expect(api.createBatches[0].map((s) => s.name)).toEqual(["Alpha", "Zeta"]);
    expect(api.idempotencyKeys[0]).toMatch(/^create-/);
  });

  it("chunks creations in batches of 100", async () => {
    const { api, deps } = setup();
    const items = Array.from({ length: 250 }, (_, i) => item("new", target(`n${i}.md`)));
    await executePublish(items, deps);
    expect(api.createBatches.map((b) => b.length)).toEqual([100, 100, 50]);
  });

  it("gives mentions of notes created in the same run the new resource id", async () => {
    const seen: Array<string | undefined> = [];
    const { api, deps } = setup({
      convert: async (req) => {
        if (req.target.key === "A.md") seen.push(req.resourceIdFor("B.md"));
        return { fields: { ...(req.target as PlannedTarget).fields, parentId: req.parentId }, blocks: [], hash: "x", blocksHash: "", warnings: [] };
      },
    });
    await executePublish([item("new", target("A.md")), item("new", target("B.md"))], deps);
    const bId = api.createBatches[0].find((s) => s.name === "B")!.id;
    expect(seen).toEqual([bId]);
  });
});

describe("images", () => {
  const imageConvert =
    (hashes: Record<string, string>): ExecutorDeps["convert"] =>
    async (req) => ({
      fields: { ...(req.target as PlannedTarget).fields, parentId: req.parentId },
      blocks: [{ kind: "image", url: `${PENDING_ASSET_PREFIX}${hashes[req.target.key]}` } as unknown as Block],
      hash: `h-${req.target.key}`,
      blocksHash: "b",
      warnings: [],
    });

  it("uploads a shared image once, into an asset folder named after the vault, and swaps in the real URL", async () => {
    const { api, manifest, deps } = setup({ convert: imageConvert({ "A.md": "crest", "B.md": "crest" }) });
    await executePublish([item("new", target("A.md")), item("new", target("B.md"))], deps);
    expect(api.uploads).toHaveLength(1);
    expect(api.folderRequests).toEqual(["My Vault"]);
    expect(manifest.assetFolderId).toBe("folder1");
    expect(manifest.assets.crest.url).toBe("https://assets/crest.png");
    for (const blocks of api.pages.values()) {
      expect((blocks[0] as unknown as { url: string }).url).toBe("https://assets/crest.png");
    }
  });

  it("does not re-upload images already in the manifest", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.assets.crest = { assetId: "a1", url: "https://assets/old.png" };
    const { api, deps } = setup({ manifest, convert: imageConvert({ "A.md": "crest" }) });
    await executePublish([item("new", target("A.md"))], deps);
    expect(api.uploads).toEqual([]);
    expect((api.pages.values().next().value![0] as unknown as { url: string }).url).toBe("https://assets/old.png");
  });

  it("fails only the notes that use an image that cannot be uploaded", async () => {
    const { api, deps } = setup({ convert: imageConvert({ "A.md": "bad", "B.md": "good" }) });
    deps.readAsset = async (hash) =>
      hash === "bad" ? null : { data: new Uint8Array([1]), contentType: "image/png", name: "good.png" };
    const summary = await executePublish([item("new", target("A.md")), item("new", target("B.md"))], deps);
    expect(summary.published).toEqual(["B.md"]);
    expect(summary.failed.map((f) => f.key)).toEqual(["A.md"]);
    expect(api.uploads).toEqual(["good.png"]);
  });
});

describe("page writes", () => {
  it("sends the stored version as If-Match for an existing page", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["A.md"] = entry();
    const { api, deps } = setup({ manifest });
    await executePublish([item("changed", target("A.md"), { entry: manifest.entries["A.md"] })], deps);
    expect(api.ifMatches).toEqual(["v7"]);
    expect(api.calls).toContain("update");
    expect(manifest.entries["A.md"]).toMatchObject({ hash: "hash-A.md", docVersion: "v1" });
  });

  it("omits If-Match when the user chose to overwrite", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["A.md"] = entry();
    const { api, deps } = setup({ manifest });
    deps.overwrite = new Set(["A.md"]);
    await executePublish([item("changed", target("A.md"))], deps);
    expect(api.ifMatches).toEqual([undefined]);
  });

  it("reports a 412 as a failure and never retries it as an overwrite", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["A.md"] = entry();
    const { api, deps } = setup({ manifest });
    api.failReplace = () => new FakeError(412, "VERSION_MISMATCH");
    const summary = await executePublish([item("changed", target("A.md"))], deps);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].message).toMatch(/edited in LegendKeeper/i);
    expect(api.calls.filter((c) => c === "replace")).toHaveLength(1);
    expect(manifest.entries["A.md"].docVersion).toBe("v7");
    expect(manifest.entries["A.md"].hash).toBe("old");
  });
});

describe("moves", () => {
  it("moves the existing resource under the new parent without creating anything", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["Places"] = entry({ kind: "folder", resourceId: "placesid" });
    manifest.entries["Ruins"] = entry({ kind: "folder", resourceId: "ruinsid1" });
    manifest.entries["Ruins/Keep.md"] = entry({ resourceId: "keepid01", parentKey: "Places" });
    const { api, deps } = setup({ manifest });
    const it1 = item("moved", target("Ruins/Keep.md"), { contentChanged: false });
    const summary = await executePublish([it1], deps);
    expect(api.moved).toEqual([["keepid01", "ruinsid1"]]);
    expect(api.createBatches).toEqual([]);
    expect(api.calls).not.toContain("replace");
    expect(manifest.entries["Ruins/Keep.md"].parentKey).toBe("Ruins");
    expect(summary.published).toEqual(["Ruins/Keep.md"]);
  });

  it("re-keys the manifest entry for a probable move and reuses the resource", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["Keep.md"] = entry({ resourceId: "keepid01" });
    const { api, deps } = setup({ manifest });
    await executePublish([item("moved", target("The Keep.md"), { previousKey: "Keep.md", probable: true, contentChanged: true })], deps);
    expect(manifest.entries["Keep.md"]).toBeUndefined();
    expect(manifest.entries["The Keep.md"].resourceId).toBe("keepid01");
    expect(api.createBatches).toEqual([]);
    expect(api.calls).toContain("update");
    expect(api.calls).toContain("replace");
  });
});

describe("deletes", () => {
  const del = (key: string, e: ManifestEntry): PlanItem => ({ type: "deleted", key, kind: e.kind, name: key, entry: e });

  it("deletes deepest first and removes the manifest entries", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["Old"] = entry({ kind: "folder", resourceId: "oldfold1" });
    manifest.entries["Old/Page.md"] = entry({ resourceId: "pageid01", parentKey: "Old" });
    const { api, deps } = setup({ manifest });
    const summary = await executePublish([del("Old", manifest.entries["Old"]), del("Old/Page.md", manifest.entries["Old/Page.md"])], deps);
    expect(api.deleted).toEqual([["pageid01", false], ["oldfold1", false]]);
    expect(manifest.entries).toEqual({});
    expect(summary.deleted).toEqual(["Old/Page.md", "Old"]);
  });

  it("asks before cascading on HAS_CHILDREN and skips when told to", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["Old"] = entry({ kind: "folder", resourceId: "oldfold1" });
    const { api, deps } = setup({ manifest });
    api.failDelete = () => new FakeError(409, "HAS_CHILDREN");
    const summary = await executePublish([del("Old", manifest.entries["Old"])], deps);
    expect(summary.skipped).toEqual([{ key: "Old", reason: expect.stringMatching(/children/) }]);
    expect(manifest.entries["Old"]).toBeDefined();
    expect(api.deleted).toEqual([["oldfold1", false]]);
  });

  it("cascades when confirmed and drops descendants from the manifest", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["Old"] = entry({ kind: "folder", resourceId: "oldfold1" });
    manifest.entries["Old/Page.md"] = entry({ resourceId: "pageid01", parentKey: "Old" });
    const { api, deps } = setup({ manifest });
    api.failDelete = (_id, cascade) => (cascade ? undefined : new FakeError(409, "HAS_CHILDREN"));
    deps.confirmCascade = async () => "cascade";
    await executePublish([del("Old", manifest.entries["Old"])], deps);
    expect(api.deleted).toEqual([["oldfold1", false], ["oldfold1", true]]);
    expect(manifest.entries).toEqual({});
  });

  it("treats an already-deleted resource as success", async () => {
    const manifest = emptyManifest("proj", "mount001");
    manifest.entries["Gone.md"] = entry();
    const { api, deps } = setup({ manifest });
    api.failDelete = () => new FakeError(404, "NOT_FOUND");
    const summary = await executePublish([del("Gone.md", manifest.entries["Gone.md"])], deps);
    expect(summary.deleted).toEqual(["Gone.md"]);
    expect(manifest.entries["Gone.md"]).toBeUndefined();
  });
});

describe("failures", () => {
  it("never publishes a hidden page visible when the key is not an admin key", async () => {
    const { api, manifest, deps } = setup();
    api.failCreate = (spec) => (spec.isHidden ? new FakeError(403, "FORBIDDEN") : undefined);
    const hidden = target("Secret.md", { fields: { name: "Secret", tags: [], aliases: [], isHidden: true } });
    const summary = await executePublish([item("new", hidden), item("new", target("Open.md"))], deps);
    expect(summary.published).toEqual(["Open.md"]);
    expect(summary.failed).toEqual([
      expect.objectContaining({ key: "Secret.md", message: "API key isn't an admin key; hidden pages can't be published" }),
    ]);
    expect(manifest.entries["Secret.md"]).toBeUndefined();
    const everythingSent = api.createBatches.flat().filter((s) => s.name === "Secret");
    expect(everythingSent.every((s) => s.isHidden === true)).toBe(true);
  });

  it("continues past a failed item and reports its code and request id", async () => {
    const { deps } = setup({
      convert: async (req) => {
        if (req.target.key === "Bad.md") throw new FakeError(400, "VALIDATION_ERROR", "bad block", "req-42");
        return { fields: { ...(req.target as PlannedTarget).fields, parentId: req.parentId }, blocks: [], hash: "x", blocksHash: "", warnings: [] };
      },
    });
    const summary = await executePublish([item("new", target("Bad.md")), item("new", target("Good.md"))], deps);
    expect(summary.published).toEqual(["Good.md"]);
    expect(summary.failed).toEqual([{ key: "Bad.md", code: "VALIDATION_ERROR", message: "bad block", requestId: "req-42" }]);
  });

  it("leaves a created-but-unwritten item in the manifest with an empty hash so it shows as Changed", async () => {
    const { api, manifest, deps } = setup();
    api.failReplace = () => new FakeError(422, "DOCUMENT_TOO_LARGE");
    await executePublish([item("new", target("Big.md"))], deps);
    expect(manifest.entries["Big.md"]).toMatchObject({ hash: "", resourceId: expect.any(String) });
  });

  it("skips children when their folder cannot be created", async () => {
    const { api, deps } = setup();
    api.failCreate = (spec) => (spec.name === "Places" ? new FakeError(400, "VALIDATION_ERROR") : undefined);
    const summary = await executePublish(
      [item("required", folder("Places")), item("new", target("Places/Keep.md"))],
      deps,
    );
    expect(summary.failed.map((f) => f.key)).toEqual(["Places"]);
    expect(summary.skipped).toEqual([{ key: "Places/Keep.md", reason: "parent not published" }]);
  });
});

describe("progress and cancellation", () => {
  it("reports progress counts and flushes the manifest at the end", async () => {
    const { deps, progress, saves } = setup();
    await executePublish([item("new", target("A.md")), item("new", target("B.md"))], deps);
    expect(progress.at(-1)).toEqual([2, 2]);
    expect(saves.at(-1)).toBe(true);
  });

  it("stops before the next operation when cancelled and keeps completed items", async () => {
    const controller = new AbortController();
    const { api, manifest, deps } = setup({ signal: controller.signal });
    let replaces = 0;
    api.onCall = (name) => {
      if (name === "replace" && ++replaces === 3) controller.abort();
    };
    const items = Array.from({ length: 10 }, (_, i) => item("new", target(`n${i}.md`)));
    const summary = await executePublish(items, deps);
    expect(summary.cancelled).toBe(true);
    expect(summary.published).toHaveLength(3);
    expect(api.calls.filter((c) => c === "replace")).toHaveLength(3);
    const written = Object.values(manifest.entries).filter((e) => e.hash !== "");
    expect(written).toHaveLength(3);
  });
});
