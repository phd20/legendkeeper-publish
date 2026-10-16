import { convertNote, type ConvertContext, type ConvertSettings, type NoteInput } from "../../src/convert";

export const settings: ConvertSettings = { hiddenKey: "lk-hidden", hiddenByDefault: false };

export function makeCtx(notes: Record<string, string> = {}, images: Record<string, string> = {}): ConvertContext {
  return {
    resolveNote: (p) => (notes[p] ? { resourceId: notes[p] } : null),
    resolveAsset: (p) => (images[p] ? { url: images[p] } : null),
  };
}

export function convert(
  body: string,
  opts: {
    notes?: Record<string, string>;
    images?: Record<string, string>;
    frontmatter?: Record<string, unknown>;
    tags?: string[];
    settings?: Partial<ConvertSettings>;
    basename?: string;
  } = {},
) {
  const input: NoteInput = {
    path: "Test.md",
    basename: opts.basename ?? "Test",
    body,
    frontmatter: opts.frontmatter ?? {},
    tags: opts.tags ?? [],
    parentId: "mount0001",
  };
  return convertNote(input, { ...settings, ...opts.settings }, makeCtx(opts.notes, opts.images));
}
