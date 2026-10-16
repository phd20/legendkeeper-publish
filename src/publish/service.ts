import { getAllTags, type App, type CachedMetadata, type TFile } from "obsidian";
import {
  PENDING_ASSET_PREFIX,
  canonicalJson,
  convertFolder,
  convertNote,
  outputHash,
  sha256Hex,
  type ConvertContext,
  type ConvertSettings,
  type Warning,
} from "../convert";
import type { ImageContentType, LkApi } from "../lk/api";
import { conversionSettingsKey, type PluginData } from "../settings/data";
import { SignatureCache, conversionSignature } from "../tracking/cache";
import { planChanges, type PlanItem, type PlannedTarget } from "../tracking/planner";
import { scanTargets, type TargetSpec, type VaultNote } from "../tracking/scan";
import type { ConvertRequest, ConvertedTarget } from "./executor";

const IMAGE_TYPES: Record<string, ImageContentType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Beyond this many pages, skip the per-page version read and rely on If-Match at write time. */
const VERSION_PRECHECK_LIMIT = 200;
const YIELD_EVERY = 25;

export interface ReviewData {
  items: PlanItem[];
  warnings: Map<string, Warning[]>;
  /** True when the LegendKeeper-edit pre-check was skipped because the change set was large. */
  precheckSkipped: boolean;
}

export interface ReviewProgress {
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
}

/** Bridges the vault (files, metadata cache, attachments) to the pure conversion and planning core. */
export class PublishService {
  private readonly conversions = new SignatureCache<ConvertedTarget>();
  private readonly assetHashes = new SignatureCache<string>();
  private readonly assetFiles = new Map<string, TFile>();
  private contentToKey = new Map<string, string>();

  constructor(
    private readonly app: App,
    private readonly getData: () => PluginData,
  ) {}

  private get convertSettings(): ConvertSettings {
    const { hiddenKey, hiddenByDefault } = this.getData().settings;
    return { hiddenKey, hiddenByDefault };
  }

  /** Every markdown file with its exclusion state. */
  listNotes(): VaultNote[] {
    const { excludeKey } = this.getData().settings;
    return this.app.vault.getMarkdownFiles().map((file) => ({
      path: file.path,
      mtime: file.stat.mtime,
      size: file.stat.size,
      excluded: this.app.metadataCache.getFileCache(file)?.frontmatter?.[excludeKey] === false,
    }));
  }

  /** The manifest key a note publishes under (its own path, or its folder's path for a folder note). */
  keyForPath(path: string): string | undefined {
    return this.contentToKey.get(path);
  }

  async buildReview(api: LkApi | null, progress: ReviewProgress = {}): Promise<ReviewData> {
    const { manifest } = this.getData();
    const targets = scanTargets(this.listNotes());
    this.contentToKey = new Map(targets.flatMap((t) => (t.contentPath ? [[t.contentPath, t.key] as const] : [])));

    const planned: PlannedTarget[] = [];
    const warnings = new Map<string, Warning[]>();
    for (const [index, target] of targets.entries()) {
      if (progress.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const entry = manifest.entries[target.key];
      const converted = await this.convertTarget({
        target,
        parentId: this.idOrPending(target.parentKey),
        ownResourceId: entry?.resourceId ?? `pending:${target.key}`,
        resourceIdFor: (key) => manifest.entries[key]?.resourceId,
      });
      const { parentId: _parentId, ...fields } = converted.fields;
      planned.push({ ...target, hash: converted.hash, blocksHash: converted.blocksHash, fields });
      if (converted.warnings.length > 0) warnings.set(target.key, converted.warnings);
      progress.onProgress?.(index + 1, targets.length);
      if (index % YIELD_EVERY === YIELD_EVERY - 1) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }

    const items = planChanges(planned, manifest);
    const precheckSkipped = await this.markEditedInLegendKeeper(items, api, progress.signal);
    return { items, warnings, precheckSkipped };
  }

  private idOrPending(key: string | null): string {
    const { manifest } = this.getData();
    if (key === null) return manifest.mountId;
    return manifest.entries[key]?.resourceId ?? `pending:${key}`;
  }

  /** Flag Changed/Moved items whose LegendKeeper page version moved on since the last publish. */
  private async markEditedInLegendKeeper(items: PlanItem[], api: LkApi | null, signal?: AbortSignal): Promise<boolean> {
    if (!api) return false;
    const candidates = items.filter(
      (i) => (i.type === "changed" || i.type === "moved") && i.entry?.docVersion && i.entry.documentId,
    );
    if (candidates.length > VERSION_PRECHECK_LIMIT) return true;
    for (const item of candidates) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const entry = item.entry!;
      try {
        const version = await api.getPageVersion(entry.resourceId, entry.documentId!);
        if (version !== entry.docVersion) item.editedInLk = true;
      } catch {
        // A missing or unreadable page is handled when the write is attempted.
      }
    }
    return false;
  }

  /** Convert one target (a note, a folder note, or a folder with an auto-generated page). */
  async convertTarget(request: ConvertRequest): Promise<ConvertedTarget> {
    const { target } = request;
    const file = target.contentPath ? this.app.vault.getFileByPath(target.contentPath) : null;
    const settingsKey = conversionSettingsKey(this.getData().settings);

    if (!file) {
      if (target.kind === "note") throw new Error(`File not found: ${target.key}`);
      const result = convertFolder(
        { name: target.name, path: target.key, resourceId: request.ownResourceId, parentId: request.parentId },
        this.convertSettings,
      );
      return this.finish(result.fields, result.blocks, result.warnings);
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const linkIds = this.linkSignature(file, cache, request);
    const signature =
      conversionSignature({ mtime: file.stat.mtime, size: file.stat.size, settingsHash: settingsKey, linkTargetsHash: linkIds }) +
      `|${request.parentId}|${request.ownResourceId}`;
    const cached = this.conversions.get(target.key, signature);
    if (cached) return cached;

    const text = await this.app.vault.cachedRead(file);
    const body = cache?.frontmatterPosition ? text.slice(cache.frontmatterPosition.end.offset) : text;
    const assets = await this.prefetchAssets(file, cache);

    const ctx: ConvertContext = {
      resolveNote: (linkpath) => {
        const id = this.resolveLinkId(linkpath, file.path, request);
        return id ? { resourceId: id } : null;
      },
      resolveAsset: (linkpath) => {
        const hash = assets.get(linkpath);
        return hash ? { url: PENDING_ASSET_PREFIX + hash } : null;
      },
    };

    const result = convertNote(
      {
        path: file.path,
        basename: target.kind === "folder" ? target.name : file.basename,
        body,
        frontmatter: (cache?.frontmatter ?? {}),
        tags: cache ? (getAllTags(cache) ?? []) : [],
        parentId: request.parentId,
      },
      this.convertSettings,
      ctx,
    );
    const converted = await this.finish(result.fields, result.blocks, result.warnings);
    this.conversions.set(target.key, signature, converted);
    return converted;
  }

  private async finish(
    fields: ConvertedTarget["fields"],
    blocks: ConvertedTarget["blocks"],
    warnings: Warning[],
  ): Promise<ConvertedTarget> {
    return {
      fields,
      blocks,
      warnings,
      hash: await outputHash({ fields, blocks }),
      blocksHash: blocks.length > 0 ? await sha256Hex(canonicalJson(blocks)) : "",
    };
  }

  private resolveLinkId(linkpath: string, sourcePath: string, request: ConvertRequest): string | undefined {
    const linked = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (!linked || linked.extension !== "md") return undefined;
    const key = this.contentToKey.get(linked.path);
    return key ? request.resourceIdFor(key) : undefined;
  }

  /** What every outgoing link currently resolves to, so the cache notices when a link target appears. */
  private linkSignature(file: TFile, cache: CachedMetadata | null, request: ConvertRequest): string {
    const links = [...(cache?.links ?? []), ...(cache?.embeds ?? [])];
    const parts = new Set<string>();
    for (const link of links) {
      const path = link.link.split("#")[0];
      if (path) parts.add(`${path}=${this.resolveLinkId(path, file.path, request) ?? ""}`);
    }
    return [...parts].sort().join(",");
  }

  /** Hash every supported image the note embeds, so conversion can stay synchronous. */
  private async prefetchAssets(file: TFile, cache: CachedMetadata | null): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const embed of cache?.embeds ?? []) {
      const linkpath = embed.link.split("#")[0];
      const ext = linkpath.slice(linkpath.lastIndexOf(".") + 1).toLowerCase();
      if (!(ext in IMAGE_TYPES)) continue;
      const image = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
      if (!image) continue;
      const signature = `${image.stat.mtime}:${image.stat.size}`;
      let hash = this.assetHashes.get(image.path, signature);
      if (!hash) {
        hash = await sha256Hex(await this.app.vault.readBinary(image));
        this.assetHashes.set(image.path, signature, hash);
      }
      this.assetFiles.set(hash, image);
      out.set(linkpath, hash);
      try {
        out.set(decodeURIComponent(linkpath), hash);
      } catch {
        // keep the raw spelling only
      }
    }
    return out;
  }

  async readAsset(hash: string): Promise<{ data: Uint8Array; contentType: ImageContentType; name: string } | null> {
    const file = this.assetFiles.get(hash);
    if (!file) return null;
    const contentType = IMAGE_TYPES[file.extension.toLowerCase()];
    if (!contentType) return null;
    return { data: new Uint8Array(await this.app.vault.readBinary(file)), contentType, name: file.name };
  }
}

export type { TargetSpec };
