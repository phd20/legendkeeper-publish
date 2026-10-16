import { ICON_SHAPES, type ConvertSettings, type IconShape, type NoteInput, type ResourceFields, type Warning } from "./types";

const NAME_MAX = 500;
const TAG_MAX = 100;
const ALIAS_MAX = 256;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const GLYPH_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

function strings(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** Resource-level fields derived from frontmatter, tags and settings. */
export function buildResourceFields(
  input: Pick<NoteInput, "path" | "basename" | "frontmatter" | "tags" | "parentId">,
  settings: ConvertSettings,
  warnings: Warning[],
): ResourceFields {
  const fm = input.frontmatter;
  const invalid = (message: string) => warnings.push({ kind: "invalid-field", message });

  let name = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : input.basename;
  if (name.length > NAME_MAX) {
    invalid(`Name was truncated to ${NAME_MAX} characters`);
    name = name.slice(0, NAME_MAX);
  }

  const tags: string[] = [];
  for (const raw of input.tags) {
    const tag = raw.replace(/^#/, "").trim();
    if (!tag || tags.includes(tag)) continue;
    if (tag.length > TAG_MAX) {
      invalid(`Tag skipped (longer than ${TAG_MAX} characters): ${tag.slice(0, 20)}…`);
      continue;
    }
    tags.push(tag);
  }

  const aliases: string[] = [];
  for (const alias of [...strings(fm.aliases), ...strings(fm.alias)]) {
    if (aliases.includes(alias)) continue;
    if (alias.length > ALIAS_MAX) {
      invalid(`Alias skipped (longer than ${ALIAS_MAX} characters)`);
      continue;
    }
    aliases.push(alias);
  }

  const fields: ResourceFields = {
    name,
    tags,
    aliases,
    isHidden: typeof fm[settings.hiddenKey] === "boolean" ? (fm[settings.hiddenKey] as boolean) : settings.hiddenByDefault,
    parentId: input.parentId,
  };

  if (fm["lk-icon"] !== undefined) {
    const glyph = fm["lk-icon"];
    if (typeof glyph === "string" && GLYPH_RE.test(glyph)) fields.iconGlyph = glyph;
    else invalid(`Invalid lk-icon: ${JSON.stringify(glyph)}`);
  }
  if (fm["lk-color"] !== undefined) {
    const color = fm["lk-color"];
    if (typeof color === "string" && COLOR_RE.test(color)) fields.iconColor = color.toUpperCase();
    else invalid(`Invalid lk-color (expected #RRGGBB): ${JSON.stringify(color)}`);
  }
  if (fm["lk-shape"] !== undefined) {
    const shape = fm["lk-shape"];
    if (typeof shape === "string" && (ICON_SHAPES as readonly string[]).includes(shape)) {
      fields.iconShape = shape as IconShape;
    } else invalid(`Invalid lk-shape: ${JSON.stringify(shape)}`);
  }
  return fields;
}
