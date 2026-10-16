import { buildResourceFields } from "./fields";
import { MarkdownConverter } from "./markdown";
import type { Block, ConvertContext, ConvertResult, ConvertSettings, NoteInput, Warning } from "./types";

export { canonicalJson, outputHash, sha256Hex } from "./hash";
export { stripFrontmatter } from "./prepare";
export * from "./types";

/** Convert one note (or a folder note) into resource fields and a page block tree. Pure. */
export function convertNote(
  input: NoteInput,
  settings: ConvertSettings,
  ctx: ConvertContext,
): ConvertResult {
  const converter = new MarkdownConverter(ctx);
  const blocks = converter.convertBody(input.body);
  const warnings: Warning[] = [...converter.warnings];
  const fields = buildResourceFields(input, settings, warnings);
  return { fields, blocks, warnings };
}

export interface FolderInput {
  name: string;
  path: string;
  /** LegendKeeper id of this folder's resource, used to list its children. */
  resourceId: string;
  parentId: string;
}

/** A folder without a usable folder note: fields from defaults and a page listing its children. */
export function convertFolder(
  input: FolderInput,
  settings: ConvertSettings,
): ConvertResult {
  const warnings: Warning[] = [];
  const fields = buildResourceFields(
    { path: input.path, basename: input.name, frontmatter: {}, tags: [], parentId: input.parentId },
    settings,
    warnings,
  );
  const collection = {
    kind: "resourceCollection",
    isTitleHidden: true,
    filter: {
      type: "filter",
      id: `${input.resourceId}-children`,
      filterType: "field",
      field: "parentId",
      operator: "equals",
      value: input.resourceId,
    },
  } as unknown as Block;
  return { fields, blocks: [collection], warnings };
}
