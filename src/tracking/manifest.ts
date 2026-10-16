export interface ManifestEntry {
  kind: "note" | "folder";
  resourceId: string;
  /** Main page document id; absent until the first page write. */
  documentId?: string;
  /** Hash of resource fields + block tree as last published. */
  hash: string;
  /** Hash of the block tree alone, used to pair deleted + new notes as probable moves. Empty when the page is empty. */
  blocksHash: string;
  /** Manifest key of the parent folder, or null for the mount point. */
  parentKey: string | null;
  /** Page document version returned by the last page write. */
  docVersion?: string;
  publishedAt: number;
}

export interface Manifest {
  version: 1;
  projectId: string;
  mountId: string;
  assetFolderId?: string;
  /** Keyed by vault path (notes) or folder path (folders). */
  entries: Record<string, ManifestEntry>;
  /** Image content hash (SHA-256) → uploaded asset. */
  assets: Record<string, { assetId: string; url: string }>;
}

export function emptyManifest(projectId = "", mountId = ""): Manifest {
  return { version: 1, projectId, mountId, entries: {}, assets: {} };
}

/** Defensive load from plugin data; anything malformed yields an empty manifest. */
export function loadManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== "object") return emptyManifest();
  const m = raw as Partial<Manifest>;
  if (m.version !== 1 || typeof m.entries !== "object" || m.entries === null) return emptyManifest();
  return {
    version: 1,
    projectId: typeof m.projectId === "string" ? m.projectId : "",
    mountId: typeof m.mountId === "string" ? m.mountId : "",
    assetFolderId: typeof m.assetFolderId === "string" ? m.assetFolderId : undefined,
    entries: { ...m.entries },
    assets: m.assets && typeof m.assets === "object" ? { ...m.assets } : {},
  };
}

/**
 * Re-key manifest entries after a vault rename, keeping LegendKeeper identities.
 * For a folder, every entry beneath it moves too, and children's parentKey follows.
 * Returns a new manifest; the input is not mutated.
 */
export function rekeyManifest(manifest: Manifest, oldPath: string, newPath: string): Manifest {
  if (oldPath === newPath) return manifest;
  const remap = (key: string): string => {
    if (key === oldPath) return newPath;
    if (key.startsWith(oldPath + "/")) return newPath + key.slice(oldPath.length);
    return key;
  };
  const entries: Record<string, ManifestEntry> = {};
  for (const [key, entry] of Object.entries(manifest.entries)) {
    entries[remap(key)] = { ...entry, parentKey: entry.parentKey === null ? null : remap(entry.parentKey) };
  }
  return { ...manifest, entries };
}
