import type { Manifest } from "./manifest";
import type { VaultNote } from "./scan";
import { scanTargets } from "./scan";

/**
 * Cheap estimate of how many items a publish would touch, without converting anything:
 * targets missing from the manifest, notes modified since they were published, and manifest paths with no target.
 */
export function estimateUnpublished(notes: VaultNote[], manifest: Manifest): number {
  const targets = scanTargets(notes);
  const mtimeByPath = new Map(notes.map((n) => [n.path, n.mtime]));
  const keys = new Set<string>();
  let count = 0;
  for (const t of targets) {
    keys.add(t.key);
    const entry = manifest.entries[t.key];
    if (!entry || entry.hash === "") {
      // Not published yet, or created in LegendKeeper but its page was never written.
      count++;
    } else if (t.contentPath && (mtimeByPath.get(t.contentPath) ?? 0) > entry.publishedAt) {
      count++;
    } else if (entry.parentKey !== t.parentKey) {
      count++;
    }
  }
  for (const key of Object.keys(manifest.entries)) if (!keys.has(key)) count++;
  return count;
}
