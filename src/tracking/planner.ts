import type { ResourceFields } from "../convert/types";
import type { Manifest, ManifestEntry } from "./manifest";
import type { TargetSpec } from "./scan";

export interface PlannedTarget extends TargetSpec {
  /** Resource fields from the review-time conversion; enough to create the resource before its page is written. */
  fields: Omit<ResourceFields, "parentId">;
  /** Hash of resource fields + block tree as they would be published now. */
  hash: string;
  /** Hash of the block tree alone; empty string for an empty page. */
  blocksHash: string;
}

export type ChangeType = "new" | "changed" | "moved" | "deleted" | "required";

export interface PlanItem {
  type: ChangeType;
  key: string;
  kind: "note" | "folder";
  name: string;
  target?: PlannedTarget;
  entry?: ManifestEntry;
  /** For a probable move: the manifest key the resource is currently tracked under. */
  previousKey?: string;
  /** For a move: whether the page or fields also changed. */
  contentChanged?: boolean;
  /** True when the move was inferred from identical content rather than seen as a rename. */
  probable?: boolean;
  /** Set by the review: the LegendKeeper page was edited since the last publish. */
  editedInLk?: boolean;
}

/**
 * Classify every target and manifest entry. Pure.
 *  - new:      note not in the manifest
 *  - required: folder not in the manifest (needed whenever a descendant is published)
 *  - changed:  output hash differs
 *  - moved:    parent folder differs, or a deleted + new pair with identical page content
 *  - deleted:  manifest entry with no target
 */
export function planChanges(targets: PlannedTarget[], manifest: Manifest): PlanItem[] {
  const items: PlanItem[] = [];
  const targetKeys = new Set(targets.map((t) => t.key));

  for (const target of targets) {
    const entry = manifest.entries[target.key];
    const base = { key: target.key, kind: target.kind, name: target.name, target };
    if (!entry) {
      items.push({ ...base, type: target.kind === "folder" ? "required" : "new" });
      continue;
    }
    const contentChanged = entry.hash !== target.hash;
    if (entry.parentKey !== target.parentKey) {
      items.push({ ...base, type: "moved", entry, contentChanged });
    } else if (contentChanged) {
      items.push({ ...base, type: "changed", entry });
    }
  }

  const deleted = Object.entries(manifest.entries)
    .filter(([key]) => !targetKeys.has(key))
    .map(([key, entry]) => ({ key, entry }));

  // Probable moves: exactly one deleted note and exactly one new note sharing a non-empty page.
  const consumedDeleted = new Set<string>();
  const newByBlocks = groupBy(
    items.filter((i) => i.type === "new" && i.target && i.target.blocksHash !== ""),
    (i) => i.target!.blocksHash,
  );
  const deletedByBlocks = groupBy(
    deleted.filter((d) => d.entry.kind === "note" && d.entry.blocksHash !== ""),
    (d) => d.entry.blocksHash,
  );
  for (const [blocksHash, news] of newByBlocks) {
    const gone = deletedByBlocks.get(blocksHash);
    if (news.length !== 1 || !gone || gone.length !== 1) continue;
    const [newItem] = news;
    const [{ key, entry }] = gone;
    consumedDeleted.add(key);
    Object.assign(newItem, {
      type: "moved" as const,
      entry,
      previousKey: key,
      probable: true,
      contentChanged: entry.hash !== newItem.target!.hash,
    });
  }

  for (const { key, entry } of deleted) {
    if (consumedDeleted.has(key)) continue;
    items.push({
      type: "deleted",
      key,
      kind: entry.kind,
      name: key.slice(key.lastIndexOf("/") + 1).replace(/\.md$/i, ""),
      entry,
    });
  }
  return items;
}

function groupBy<T>(list: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const k = keyOf(item);
    const group = map.get(k);
    if (group) group.push(item);
    else map.set(k, [item]);
  }
  return map;
}
