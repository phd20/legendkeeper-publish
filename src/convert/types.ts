import type { Block, Run } from "@legendkeeper/sdk/blocks";

export type { Block, Run };

export type WarningKind =
  | "unresolved-link"
  | "unsupported-link"
  | "unsupported-embed"
  | "missing-image"
  | "transclusion"
  | "degraded"
  | "invalid-field";

export interface Warning {
  kind: WarningKind;
  message: string;
}

/** Everything the converter needs from the outside world. Injected so convert/ stays pure. */
export interface ConvertContext {
  /** Resolve a wikilink / markdown link path to a publishable resource, or null if unresolved or unpublished. */
  resolveNote(linkpath: string): { resourceId: string } | null;
  /**
   * Resolve an embedded image to an asset URL, or null if the file is missing.
   * For images not yet uploaded the caller returns a stable placeholder URL (see PENDING_ASSET_PREFIX).
   */
  resolveAsset(linkpath: string): { url: string } | null;
}

export interface ConvertSettings {
  hiddenKey: string;
  hiddenByDefault: boolean;
}

export interface ResourceFields {
  name: string;
  tags: string[];
  aliases: string[];
  iconGlyph?: string;
  iconColor?: string;
  iconShape?: IconShape;
  isHidden: boolean;
  parentId: string;
}

export const ICON_SHAPES = [
  "pin",
  "diamond",
  "flag",
  "marker",
  "shield",
  "circle",
  "banner",
  "arch",
  "none",
] as const;
export type IconShape = (typeof ICON_SHAPES)[number];

export interface NoteInput {
  /** Vault path, used in warnings only. */
  path: string;
  /** File basename without extension, or the folder name for a folder note. */
  basename: string;
  /** Markdown body with frontmatter already removed (see stripFrontmatter). */
  body: string;
  frontmatter: Record<string, unknown>;
  /** All tags for the note (frontmatter and inline); leading # optional. */
  tags: string[];
  /** LegendKeeper id of the parent folder resource, or the mount point. */
  parentId: string;
}

export interface ConvertResult {
  fields: ResourceFields;
  blocks: Block[];
  warnings: Warning[];
}

/** Prefix of placeholder asset URLs for images that are not uploaded yet; the executor swaps them for real URLs. */
export const PENDING_ASSET_PREFIX = "lk-pending-asset:";
