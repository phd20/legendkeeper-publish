import type { PlanItem } from "../tracking/planner";

export type Group = "new" | "changed" | "moved" | "deleted" | "edited" | "required";

export const GROUP_ORDER: Group[] = ["new", "changed", "moved", "required", "edited", "deleted"];

export const GROUP_LABEL: Record<Group, string> = {
  new: "New",
  changed: "Changed",
  moved: "Moved / renamed",
  required: "Required parents",
  edited: "Edited in LegendKeeper",
  deleted: "Deleted",
};

export function groupOf(item: PlanItem): Group {
  return item.editedInLk && item.type !== "new" && item.type !== "required" && item.type !== "deleted" ? "edited" : item.type;
}

/** New, Changed and Moved are checked by default; Deleted and Edited-in-LegendKeeper are not. */
export function defaultSelection(items: PlanItem[]): Set<string> {
  const selected = new Set<string>();
  for (const item of items) {
    const group = groupOf(item);
    if (group === "new" || group === "changed" || group === "moved") selected.add(item.key);
  }
  return normalizeSelection(items, selected);
}

function parentKeyOf(item: PlanItem): string | null {
  return item.target?.parentKey ?? null;
}

/** New folders that notes can sit under: pure parents ("required") and folders that have a page of their own. */
function newFolders(items: PlanItem[]): Map<string, PlanItem> {
  return new Map(items.filter((i) => i.kind === "folder" && (i.type === "required" || i.type === "new")).map((i) => [i.key, i]));
}

/** Keys of the required (new) folders an item depends on, nearest first. */
function requiredAncestors(item: PlanItem, required: Map<string, PlanItem>): string[] {
  const out: string[] = [];
  let parent = parentKeyOf(item);
  while (parent !== null && required.has(parent)) {
    out.push(parent);
    parent = parentKeyOf(required.get(parent)!);
  }
  return out;
}

/**
 * Make a selection consistent: every required folder above a selected item is selected, and a required folder
 * with no selected descendant is not.
 */
export function normalizeSelection(items: PlanItem[], selection: ReadonlySet<string>): Set<string> {
  const required = newFolders(items);
  const needed = new Set<string>();
  const out = new Set<string>();
  for (const item of items) {
    if (item.type === "required" || !selection.has(item.key)) continue;
    out.add(item.key);
    for (const ancestor of requiredAncestors(item, required)) needed.add(ancestor);
  }
  for (const key of needed) out.add(key);
  return out;
}

/** A required parent cannot be unchecked while any selected item sits beneath it. */
export function isLocked(item: PlanItem, items: PlanItem[], selection: ReadonlySet<string>): boolean {
  if (item.kind !== "folder" || (item.type !== "required" && item.type !== "new")) return false;
  const required = newFolders(items);
  return items.some(
    (other) =>
      other.key !== item.key &&
      selection.has(other.key) &&
      other.type !== "deleted" &&
      requiredAncestors(other, required).includes(item.key),
  );
}

/** Set one item's checked state, keeping required parents consistent. */
export function setChecked(items: PlanItem[], selection: ReadonlySet<string>, key: string, checked: boolean): Set<string> {
  const next = new Set(selection);
  if (checked) next.add(key);
  else next.delete(key);
  return normalizeSelection(items, next);
}

/** Select or clear a whole group at once. */
export function setGroup(items: PlanItem[], selection: ReadonlySet<string>, group: Group, checked: boolean): Set<string> {
  const next = new Set(selection);
  for (const item of items) {
    if (groupOf(item) !== group) continue;
    if (checked) next.add(item.key);
    else next.delete(item.key);
  }
  return normalizeSelection(items, next);
}

/** The items to run, in plan order, plus the keys whose LegendKeeper edits will be overwritten. */
export function selectedRun(items: PlanItem[], selection: ReadonlySet<string>): { items: PlanItem[]; overwrite: Set<string> } {
  const chosen = items.filter((i) => selection.has(i.key));
  return {
    items: chosen,
    overwrite: new Set(chosen.filter((i) => groupOf(i) === "edited").map((i) => i.key)),
  };
}

/** Restrict a plan to one note and the new folders it needs ("Publish current note…"). */
export function filterToNote(items: PlanItem[], key: string): PlanItem[] {
  const target = items.find((i) => i.key === key);
  if (!target) return [];
  const required = newFolders(items);
  const keep = new Set([key, ...requiredAncestors(target, required)]);
  return items.filter((i) => keep.has(i.key));
}
