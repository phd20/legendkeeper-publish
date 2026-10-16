import { lkErrorInfo, type CreateResourceSpec, type ImageContentType, type LkApi } from "../lk/api";
import { mintResourceId } from "../lk/ids";
import type { Block, ResourceFields, Warning } from "../convert/types";
import type { Manifest, ManifestEntry } from "../tracking/manifest";
import type { PlanItem } from "../tracking/planner";
import type { TargetSpec } from "../tracking/scan";
import { collectPendingAssets, substituteAssets } from "./assets";

export interface ConvertedTarget {
  fields: ResourceFields;
  /** Blocks with placeholder image URLs, exactly as hashed. */
  blocks: Block[];
  hash: string;
  blocksHash: string;
  warnings: Warning[];
}

export interface ConvertRequest {
  target: TargetSpec;
  /** LegendKeeper id of the parent folder resource, or the mount point. */
  parentId: string;
  /** This target's own resource id. */
  ownResourceId: string;
  /** Resource id for a manifest key, if that resource exists (published earlier or created in this run). */
  resourceIdFor(key: string): string | undefined;
}

export interface ExecutorDeps {
  api: LkApi;
  manifest: Manifest;
  vaultName: string;
  convert(request: ConvertRequest): Promise<ConvertedTarget>;
  readAsset(hash: string): Promise<{ data: Uint8Array; contentType: ImageContentType; name: string } | null>;
  /** Persist the manifest. `flush` is true at the end of a run. */
  saveManifest(flush: boolean): Promise<void>;
  /** Asked when deleting a resource that still has children the plugin does not manage. */
  confirmCascade(item: PlanItem): Promise<"cascade" | "skip">;
  onProgress?(done: number, total: number, label: string): void;
  signal?: AbortSignal;
  now?: () => number;
  /** Keys whose LegendKeeper-side edits the user chose to overwrite. */
  overwrite?: ReadonlySet<string>;
}

export interface RunFailure {
  key: string;
  code?: string;
  message: string;
  requestId?: string;
}

export interface RunSummary {
  published: string[];
  deleted: string[];
  skipped: Array<{ key: string; reason: string }>;
  failed: RunFailure[];
  cancelled: boolean;
}

const CREATE_CHUNK = 100;
const ADMIN_MESSAGE = "API key isn't an admin key; hidden pages can't be published";

export async function executePublish(items: PlanItem[], deps: ExecutorDeps): Promise<RunSummary> {
  return new Executor(items, deps).run();
}

class Cancelled extends Error {}

class Executor {
  private readonly summary: RunSummary = { published: [], deleted: [], skipped: [], failed: [], cancelled: false };
  private readonly newIds = new Map<string, string>();
  private readonly createdDocIds = new Map<string, string>();
  private readonly dead = new Set<string>(); // keys that failed or were skipped
  private readonly finished = new Set<string>();
  private readonly total: number;
  private readonly now: () => number;
  private readonly assetUrls = new Map<string, string>();
  private readonly assetFailures = new Map<string, string>();
  private readonly converted = new Map<string, ConvertedTarget>();
  private readonly activeItems: PlanItem[];
  private readonly deletes: PlanItem[];

  constructor(
    private readonly items: PlanItem[],
    private readonly deps: ExecutorDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.deletes = items.filter((i) => i.type === "deleted");
    this.activeItems = items.filter((i) => i.type !== "deleted");
    this.total = items.length;
    for (const [hash, asset] of Object.entries(deps.manifest.assets)) this.assetUrls.set(hash, asset.url);
  }

  async run(): Promise<RunSummary> {
    try {
      this.adoptProbableMoves();
      await this.createResources();
      await this.prepareContent();
      await this.uploadImages();
      await this.moveResources();
      await this.writeContent();
      await this.deleteResources();
    } catch (error) {
      if (!(error instanceof Cancelled) && !isAbort(error)) throw error;
      this.summary.cancelled = true;
    } finally {
      await this.deps.saveManifest(true);
    }
    return this.summary;
  }

  // ───────────────────────── phases ─────────────────────────

  /** A probable move reuses the resource tracked under its old path. */
  private adoptProbableMoves(): void {
    for (const item of this.activeItems) {
      if (item.type === "moved" && item.previousKey && item.previousKey !== item.key) {
        const entry = this.deps.manifest.entries[item.previousKey];
        if (entry) {
          this.deps.manifest.entries[item.key] = entry;
          delete this.deps.manifest.entries[item.previousKey];
        }
      }
    }
  }

  private async createResources(): Promise<void> {
    const creating = this.activeItems
      .filter((i) => (i.type === "new" || i.type === "required") && i.target)
      .sort((a, b) => depthOf(a.key) - depthOf(b.key));
    for (const item of creating) this.newIds.set(item.key, mintResourceId());

    // Placeholder fields are enough to create; real content is written afterwards from a fresh conversion.
    for (let start = 0; start < creating.length; start += CREATE_CHUNK) {
      this.checkCancelled();
      const chunk = creating.slice(start, start + CREATE_CHUNK).filter((i) => this.parentUsable(i));
      if (chunk.length === 0) continue;
      const specs = chunk.map((item) => this.createSpec(item));
      try {
        const created = await this.deps.api.createResources(specs, `create-${specs.map((s) => s.id).join(",").slice(0, 200)}`);
        chunk.forEach((item, i) => this.recordCreated(item, created[i]?.documentId));
      } catch (error) {
        if (isAbort(error)) throw error;
        // Isolate the offending item(s): retry one by one.
        for (const item of chunk) {
          this.checkCancelled();
          if (!this.parentUsable(item)) continue;
          try {
            const [created] = await this.deps.api.createResources([this.createSpec(item)], `create-${this.newIds.get(item.key)}`);
            this.recordCreated(item, created?.documentId);
          } catch (single) {
            if (isAbort(single)) throw single;
            this.fail(item, single, item.target?.fields.isHidden);
          }
        }
      }
    }
  }

  private parentUsable(item: PlanItem): boolean {
    const parentKey = item.target?.parentKey ?? null;
    if (parentKey !== null && this.dead.has(parentKey)) {
      this.skip(item, "parent not published");
      return false;
    }
    return true;
  }

  private createSpec(item: PlanItem): CreateResourceSpec {
    const target = item.target!;
    const preview = target.fields;
    return {
      id: this.newIds.get(item.key)!,
      name: preview.name,
      parentId: this.parentIdOf(target.parentKey),
      ...(preview.tags.length ? { tags: preview.tags } : {}),
      ...(preview.aliases.length ? { aliases: preview.aliases } : {}),
      ...(preview.iconGlyph ? { iconGlyph: preview.iconGlyph } : {}),
      ...(preview.iconColor ? { iconColor: preview.iconColor } : {}),
      ...(preview.iconShape ? { iconShape: preview.iconShape } : {}),
      ...(preview.isHidden ? { isHidden: true } : {}),
    };
  }

  private recordCreated(item: PlanItem, documentId: string | undefined): void {
    const target = item.target!;
    const id = this.newIds.get(item.key)!;
    // Recorded with an empty hash: if the page write below fails, the next review shows it as Changed.
    this.deps.manifest.entries[item.key] = {
      kind: target.kind,
      resourceId: id,
      documentId,
      hash: "",
      blocksHash: "",
      parentKey: target.parentKey,
      publishedAt: this.now(),
    };
    if (documentId) this.createdDocIds.set(item.key, documentId);
  }

  /** Convert every item that needs a page write or field patch, now that new ids exist. */
  private async prepareContent(): Promise<void> {
    for (const item of this.activeItems) {
      this.checkCancelled();
      if (this.dead.has(item.key) || !item.target) continue;
      if (item.type === "moved" && item.contentChanged === false) continue;
      const entry = this.deps.manifest.entries[item.key];
      if (!entry) continue; // creation failed
      try {
        const converted = await this.deps.convert({
          target: item.target,
          parentId: this.parentIdOf(item.target.parentKey),
          ownResourceId: entry.resourceId,
          resourceIdFor: (key) => this.resourceIdFor(key),
        });
        this.converted.set(item.key, converted);
      } catch (error) {
        this.fail(item, error);
      }
    }
  }

  private async uploadImages(): Promise<void> {
    const wanted = new Set<string>();
    for (const converted of this.converted.values()) {
      for (const hash of collectPendingAssets(converted.blocks)) if (!this.assetUrls.has(hash)) wanted.add(hash);
    }
    if (wanted.size === 0) return;

    let folderId = this.deps.manifest.assetFolderId;
    for (const hash of wanted) {
      this.checkCancelled();
      try {
        const file = await this.deps.readAsset(hash);
        if (!file) throw new Error("Image file is no longer in the vault");
        folderId ??= await this.deps.api.ensureAssetFolder(this.deps.vaultName);
        this.deps.manifest.assetFolderId = folderId;
        const asset = await this.deps.api.uploadImage({ ...file, folderId });
        this.deps.manifest.assets[hash] = { assetId: asset.id, url: asset.url };
        this.assetUrls.set(hash, asset.url);
        await this.deps.saveManifest(false);
      } catch (error) {
        if (isAbort(error)) throw error;
        this.assetFailures.set(hash, lkErrorInfo(error).message);
      }
    }
  }

  private async moveResources(): Promise<void> {
    for (const item of this.activeItems) {
      this.checkCancelled();
      if (item.type !== "moved" || !item.target || this.dead.has(item.key)) continue;
      const entry = this.deps.manifest.entries[item.key];
      if (!entry) continue;
      if (entry.parentKey === item.target.parentKey) continue;
      if (item.target.parentKey !== null && this.dead.has(item.target.parentKey)) {
        this.skip(item, "parent not published");
        continue;
      }
      try {
        await this.deps.api.moveResource(entry.resourceId, this.parentIdOf(item.target.parentKey));
        entry.parentKey = item.target.parentKey;
        await this.deps.saveManifest(false);
      } catch (error) {
        this.fail(item, error);
      }
    }
  }

  private async writeContent(): Promise<void> {
    for (const item of this.activeItems) {
      this.checkCancelled();
      if (this.dead.has(item.key) || this.finished.has(item.key)) continue;
      const entry = this.deps.manifest.entries[item.key];
      const converted = this.converted.get(item.key);
      if (!entry || !item.target) continue;

      // A pure move needs no content write.
      if (!converted) {
        this.complete(item, "published");
        continue;
      }

      const missingImage = collectPendingAssets(converted.blocks).find((h) => !this.assetUrls.has(h));
      if (missingImage) {
        this.fail(item, new Error(`Image upload failed: ${this.assetFailures.get(missingImage) ?? "unknown error"}`));
        continue;
      }

      try {
        const isNew = item.type === "new" || item.type === "required";
        if (!isNew && entry.hash !== converted.hash) {
          await this.deps.api.updateResource(entry.resourceId, patchOf(converted.fields));
        }
        const documentId =
          entry.documentId ?? this.createdDocIds.get(item.key) ?? (await this.deps.api.getMainDocumentId(entry.resourceId));
        const overwrite = this.deps.overwrite?.has(item.key) === true;
        const ifMatch = isNew || overwrite ? undefined : entry.docVersion;
        const written = await this.deps.api.replacePage(
          entry.resourceId,
          documentId,
          substituteAssets(converted.blocks, this.assetUrls),
          ifMatch,
        );
        Object.assign(entry, {
          documentId,
          hash: converted.hash,
          blocksHash: converted.blocksHash,
          docVersion: written.version,
          parentKey: item.target.parentKey,
          publishedAt: this.now(),
        } satisfies Partial<ManifestEntry>);
        this.complete(item, "published");
      } catch (error) {
        if (isAbort(error)) throw error;
        const info = lkErrorInfo(error);
        if (info.status === 412 || info.code === "VERSION_MISMATCH") {
          this.fail(item, undefined, false, {
            ...info,
            message: "Edited in LegendKeeper since the review; review again to overwrite",
          });
        } else {
          this.fail(item, error, converted.fields.isHidden);
        }
      }
      await this.deps.saveManifest(false);
    }
  }

  private async deleteResources(): Promise<void> {
    const ordered = [...this.deletes].sort((a, b) => depthOf(b.key) - depthOf(a.key));
    for (const item of ordered) {
      this.checkCancelled();
      const entry = this.deps.manifest.entries[item.key];
      if (!entry) {
        this.complete(item, "deleted");
        continue;
      }
      try {
        await this.deleteOne(item, entry);
      } catch (error) {
        if (isAbort(error)) throw error;
        this.fail(item, error);
      }
      await this.deps.saveManifest(false);
    }
  }

  private async deleteOne(item: PlanItem, entry: ManifestEntry): Promise<void> {
    const remove = async (cascade: boolean) => {
      try {
        await this.deps.api.deleteResource(entry.resourceId, cascade);
      } catch (error) {
        const code = lkErrorInfo(error).code;
        if (code === "NOT_FOUND" || code === "ALREADY_DELETED") return; // already gone
        throw error;
      }
    };
    try {
      await remove(false);
    } catch (error) {
      if (lkErrorInfo(error).code !== "HAS_CHILDREN") throw error;
      if ((await this.deps.confirmCascade(item)) === "skip") {
        this.skip(item, "has children in LegendKeeper; skipped");
        return;
      }
      await remove(true);
      // Everything beneath it went to the trash too.
      for (const key of Object.keys(this.deps.manifest.entries)) {
        if (key.startsWith(item.key + "/")) delete this.deps.manifest.entries[key];
      }
    }
    delete this.deps.manifest.entries[item.key];
    this.complete(item, "deleted");
  }

  // ───────────────────────── helpers ─────────────────────────

  private parentIdOf(parentKey: string | null): string {
    if (parentKey === null) return this.deps.manifest.mountId;
    return this.resourceIdFor(parentKey) ?? this.deps.manifest.mountId;
  }

  private resourceIdFor(key: string): string | undefined {
    const existing = this.deps.manifest.entries[key];
    if (existing) return existing.resourceId;
    // A resource about to be created in this run (its parent may be created in the same batch).
    return this.dead.has(key) ? undefined : this.newIds.get(key);
  }

  private checkCancelled(): void {
    if (this.deps.signal?.aborted) throw new Cancelled();
  }

  private complete(item: PlanItem, outcome: "published" | "deleted"): void {
    if (this.finished.has(item.key)) return;
    this.finished.add(item.key);
    (outcome === "published" ? this.summary.published : this.summary.deleted).push(item.key);
    this.progress(item);
  }

  private skip(item: PlanItem, reason: string): void {
    if (this.finished.has(item.key)) return;
    this.finished.add(item.key);
    this.dead.add(item.key);
    this.summary.skipped.push({ key: item.key, reason });
    this.progress(item);
  }

  private fail(item: PlanItem, error: unknown, wasHidden?: boolean, info = lkErrorInfo(error)): void {
    if (this.finished.has(item.key)) return;
    this.finished.add(item.key);
    this.dead.add(item.key);
    const message = info.status === 403 && wasHidden ? ADMIN_MESSAGE : info.message;
    this.summary.failed.push({ key: item.key, code: info.code, message, requestId: info.requestId });
    this.progress(item);
  }

  private progress(item: PlanItem): void {
    this.deps.onProgress?.(this.finished.size, this.total, item.key);
  }
}

function depthOf(key: string): number {
  return key.split("/").length;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function patchOf(fields: ResourceFields) {
  const { parentId: _parentId, ...rest } = fields;
  return rest;
}
