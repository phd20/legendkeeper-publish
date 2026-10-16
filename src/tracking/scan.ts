export interface VaultNote {
  /** Vault-relative path, e.g. "Places/Keep.md". */
  path: string;
  mtime: number;
  size: number;
  /** True when the exclusion key is set to false in frontmatter. */
  excluded: boolean;
}

export interface TargetSpec {
  /** Manifest key: note path, or folder path for folders. */
  key: string;
  kind: "note" | "folder";
  name: string;
  /** Manifest key of the parent folder, or null for the mount point. */
  parentKey: string | null;
  /**
   * The note that supplies this target's page. For a note, its own path.
   * For a folder, its folder note (Folder/Folder.md) when present and not excluded; otherwise null (auto page).
   */
  contentPath: string | null;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stem(file: string): string {
  return file.replace(/\.md$/i, "");
}

/**
 * Turn the vault's notes into publish targets: one per publishable note plus one per folder that has a
 * publishable descendant. Folder notes (Folder/Folder.md) become the folder's page, not a separate target.
 * Parents come before children; folders sort before notes, then alphabetically.
 */
export function scanTargets(notes: VaultNote[]): TargetSpec[] {
  const publishable = notes.filter((n) => !n.excluded);
  const byPath = new Map(notes.map((n) => [n.path, n]));

  const isFolderNote = (n: VaultNote): boolean => {
    const dir = dirOf(n.path);
    return dir !== "" && stem(baseOf(n.path)) === baseOf(dir);
  };

  // Every ancestor folder of a publishable note gets a resource.
  const folders = new Set<string>();
  for (const n of publishable) {
    for (let dir = dirOf(n.path); dir !== ""; dir = dirOf(dir)) folders.add(dir);
  }

  const targets: TargetSpec[] = [];
  for (const folder of folders) {
    const folderNotePath = `${folder}/${baseOf(folder)}.md`;
    const folderNote = byPath.get(folderNotePath);
    targets.push({
      key: folder,
      kind: "folder",
      name: baseOf(folder),
      parentKey: dirOf(folder) || null,
      contentPath: folderNote && !folderNote.excluded ? folderNotePath : null,
    });
  }
  for (const n of publishable) {
    if (isFolderNote(n)) continue;
    targets.push({
      key: n.path,
      kind: "note",
      name: stem(baseOf(n.path)),
      parentKey: dirOf(n.path) || null,
      contentPath: n.path,
    });
  }

  const depth = (t: TargetSpec) => t.key.split("/").length;
  return targets.sort(
    (a, b) =>
      depth(a) - depth(b) ||
      (a.parentKey ?? "").localeCompare(b.parentKey ?? "") ||
      (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1) ||
      a.name.localeCompare(b.name),
  );
}
