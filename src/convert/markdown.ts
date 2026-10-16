import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type {
  Blockquote,
  Code,
  FootnoteDefinition,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import { TOKEN_RE, prepareBody, type WikiToken } from "./prepare";
import type { Block, ConvertContext, Run, Warning, WarningKind } from "./types";

const HIGHLIGHT_COLOR = "#FFE066";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const OTHER_ATTACHMENT_EXT = new Set([
  "svg", "avif", "bmp", "heic", "tif", "tiff", "ico",
  "pdf", "mp3", "wav", "m4a", "ogg", "flac", "webm", "mp4", "mov", "mkv", "ogv",
  "zip", "csv", "json", "docx", "xlsx", "pptx", "canvas", "base",
]);

type CalloutTone = "info" | "note" | "success" | "warning" | "error";
const CALLOUT_TONES: Record<string, CalloutTone> = {
  info: "info", todo: "info", tip: "info", hint: "info", important: "info",
  note: "note", abstract: "note", summary: "note", tldr: "note", quote: "note",
  cite: "note", example: "note", question: "note", help: "note", faq: "note",
  success: "success", check: "success", done: "success",
  warning: "warning", caution: "warning", attention: "warning",
  danger: "error", error: "error", failure: "error", fail: "error", missing: "error", bug: "error",
};

interface Marks {
  bold?: true;
  italic?: true;
  strike?: true;
  link?: string;
  highlight?: string;
}

interface ImageItem {
  image: { url: string; alt?: string };
}
type Item = Run | ImageItem;

function isImage(item: Item): item is ImageItem {
  return "image" in item;
}

function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}

const loose = <T>(value: unknown): T => value as T;

export class MarkdownConverter {
  readonly warnings: Warning[] = [];
  private readonly seenWarnings = new Set<string>();
  private inlineDepth = 0;
  private highlightOn = false;

  constructor(
    private readonly ctx: ConvertContext,
    private tokens: WikiToken[] = [],
  ) {}

  /** Convert a markdown body (frontmatter already removed) to LegendKeeper blocks. */
  convertBody(body: string): Block[] {
    const prepared = prepareBody(body);
    this.tokens = prepared.tokens;
    const tree: Root = fromMarkdown(prepared.text, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    return this.blocks(tree.children);
  }

  private warn(kind: WarningKind, message: string, link?: string): void {
    const key = `${kind}:${message}`;
    if (this.seenWarnings.has(key)) return;
    this.seenWarnings.add(key);
    this.warnings.push({ kind, message, ...(link ? { link } : {}) });
  }

  // ───────────────────────── block level ─────────────────────────

  private blocks(nodes: RootContent[]): Block[] {
    const out: Block[] = [];
    for (const node of nodes) out.push(...this.block(node));
    return out;
  }

  private block(node: RootContent): Block[] {
    switch (node.type) {
      case "paragraph":
        return this.paragraph(node);
      case "heading":
        return [this.heading(node)];
      case "blockquote":
        return this.blockquote(node);
      case "code":
        return [this.code(node)];
      case "thematicBreak":
        return [loose<Block>({ kind: "rule" })];
      case "list":
        return this.list(node);
      case "table":
        return [this.table(node)];
      case "html":
        this.warn("degraded", "HTML is not supported and was published as a code block");
        return [loose<Block>({ kind: "code", language: "html", text: node.value })];
      case "footnoteDefinition":
        return this.footnoteDefinition(node);
      case "definition":
      case "yaml":
        return [];
      default:
        return [];
    }
  }

  private paragraph(node: Paragraph): Block[] {
    const items = this.inline(node.children, {});
    // $$ … $$ display math has no LegendKeeper equivalent.
    const plain = node.children.length === 1 && node.children[0].type === "text" ? node.children[0].value.trim() : "";
    if (plain.startsWith("$$") && plain.endsWith("$$") && plain.length > 4) {
      this.warn("degraded", "Math is not supported and was published as a code block");
      return [loose<Block>({ kind: "code", language: "latex", text: plain.slice(2, -2).trim() })];
    }
    return this.paragraphBlocks(items);
  }

  /** Split inline items into paragraphs and standalone image blocks. */
  private paragraphBlocks(items: Item[]): Block[] {
    const out: Block[] = [];
    let runs: Run[] = [];
    const flush = () => {
      const content = normalizeRuns(runs);
      runs = [];
      if (content.length === 0) return;
      if (content.every((r) => "text" in r && r.text.trim() === "") ) return;
      out.push(loose<Block>({ kind: "paragraph", content }));
    };
    for (const item of items) {
      if (isImage(item)) {
        flush();
        out.push(
          loose<Block>({
            kind: "image",
            url: item.image.url,
            ...(item.image.alt ? { alt: item.image.alt } : {}),
          }),
        );
      } else {
        runs.push(item);
      }
    }
    flush();
    return out;
  }

  private heading(node: Heading): Block {
    const items = this.inline(node.children, {});
    if (items.some(isImage)) this.warn("degraded", "Images inside headings were removed");
    return loose<Block>({
      kind: "heading",
      level: node.depth,
      content: normalizeRuns(items.filter((i): i is Run => !isImage(i))),
    });
  }

  private code(node: Code): Block {
    const lang = node.lang?.trim().toLowerCase();
    if (lang === "dataview" || lang === "dataviewjs") {
      this.warn("degraded", "Dataview queries are not executed and were published as code");
    } else if (lang === "mermaid") {
      this.warn("degraded", "Mermaid diagrams are not rendered and were published as code");
    }
    return loose<Block>({
      kind: "code",
      ...(node.lang ? { language: node.lang } : {}),
      text: node.value,
    });
  }

  private blockquote(node: Blockquote): Block[] {
    const callout = this.callout(node);
    if (callout) return [callout];
    return [loose<Block>({ kind: "quote", children: this.blocks(node.children) })];
  }

  private callout(node: Blockquote): Block | null {
    const first = node.children[0];
    if (!first || first.type !== "paragraph") return null;
    const head = first.children[0];
    if (!head || head.type !== "text") return null;
    const m = /^\[!([A-Za-z0-9_-]+)\][+-]?[ \t]*/.exec(head.value);
    if (!m) return null;
    const type = m[1].toLowerCase();

    // Split the first paragraph into title (up to the first newline) and body.
    const rest: PhrasingContent[] = [{ ...head, value: head.value.slice(m[0].length) }, ...first.children.slice(1)];
    const title: PhrasingContent[] = [];
    const body: PhrasingContent[] = [];
    let inBody = false;
    for (const child of rest) {
      if (inBody) {
        body.push(child);
      } else if (child.type === "text" && child.value.includes("\n")) {
        const nl = child.value.indexOf("\n");
        title.push({ ...child, value: child.value.slice(0, nl) });
        body.push({ ...child, value: child.value.slice(nl + 1) });
        inBody = true;
      } else if (child.type === "break") {
        inBody = true;
      } else {
        title.push(child);
      }
    }

    const children: Block[] = [];
    const titleRuns = normalizeRuns(
      normalizeRuns(this.inline(title, {}).filter((i): i is Run => !isImage(i))).map((r) =>
        "text" in r && !r.code ? { ...r, bold: true } : r,
      ),
    );
    if (titleRuns.length > 0 && !titleRuns.every((r) => "text" in r && r.text.trim() === "")) {
      children.push(loose<Block>({ kind: "paragraph", content: titleRuns }));
    }
    if (body.length > 0) {
      children.push(...this.paragraphBlocks(this.inline(body, {})));
    }
    children.push(...this.blocks(node.children.slice(1)));

    if (type === "secret") {
      return loose<Block>({ kind: "secret", children });
    }
    return loose<Block>({ kind: "callout", tone: CALLOUT_TONES[type] ?? "note", children });
  }

  private list(node: List): Block[] {
    const out: Block[] = [];
    let group: ListItem[] = [];
    let groupIsTask = false;

    const flushGroup = () => {
      if (group.length === 0) return;
      if (groupIsTask) out.push(...this.taskList(group));
      else out.push(this.plainList(node, group));
      group = [];
    };

    for (const item of node.children) {
      const isTask = typeof item.checked === "boolean";
      if (group.length > 0 && isTask !== groupIsTask) flushGroup();
      groupIsTask = isTask;
      group.push(item);
    }
    flushGroup();
    return out;
  }

  private plainList(node: List, items: ListItem[]): Block {
    const children = items.map((item) => this.listItem(item));
    if (node.ordered) {
      return loose<Block>({
        kind: "orderedList",
        ...(node.start && node.start !== 1 ? { start: node.start } : {}),
        children,
      });
    }
    return loose<Block>({ kind: "bulletList", children });
  }

  private listItem(item: ListItem): Block {
    const [first, ...rest] = item.children;
    const children: Block[] = [];
    if (first && first.type === "paragraph") {
      const blocks = this.paragraph(first);
      // The first child of a listItem must be a paragraph.
      if (blocks[0]?.kind === "paragraph") children.push(...blocks);
      else children.push(loose<Block>({ kind: "paragraph", content: [] }), ...blocks);
    } else {
      children.push(loose<Block>({ kind: "paragraph", content: [] }));
      if (first) children.push(...this.block(first));
    }
    children.push(...this.blocks(rest));
    return loose<Block>({ kind: "listItem", children });
  }

  private taskList(items: ListItem[]): Block[] {
    const taskItems: Block[] = [];
    const overflow: Block[] = [];
    for (const item of items) {
      const [first, ...rest] = item.children;
      const items0 = first && first.type === "paragraph" ? this.inline(first.children, {}) : [];
      taskItems.push(
        loose<Block>({
          kind: "taskItem",
          checked: item.checked === true,
          content: normalizeRuns(items0.filter((i): i is Run => !isImage(i))),
        }),
      );
      if (rest.length > 0) {
        this.warn("degraded", "Content nested inside a task item was moved below the task list");
        overflow.push(...this.blocks(rest));
      }
    }
    return [loose<Block>({ kind: "taskList", children: taskItems }), ...overflow];
  }

  private table(node: Table): Block {
    const rows = node.children.map((row, rowIndex) =>
      loose<Block>({
        kind: "tableRow",
        children: row.children.map((cell) => {
          const blocks = this.paragraphBlocks(this.inline(cell.children, {}));
          return loose<Block>({
            kind: "tableCell",
            ...(rowIndex === 0 ? { header: true } : {}),
            children: blocks.length > 0 ? blocks : [loose<Block>({ kind: "paragraph", content: [] })],
          });
        }),
      }),
    );
    return loose<Block>({ kind: "table", children: rows });
  }

  private footnoteDefinition(node: FootnoteDefinition): Block[] {
    this.warn("degraded", "Footnotes are not supported and were published as plain paragraphs");
    const out: Block[] = [];
    const [first, ...rest] = node.children;
    const label: Run = { text: `[${node.label ?? node.identifier}]: ` };
    if (first && first.type === "paragraph") {
      out.push(...this.paragraphBlocks([label, ...this.inline(first.children, {})]));
    } else {
      out.push(loose<Block>({ kind: "paragraph", content: [label] }));
      if (first) out.push(...this.block(first));
    }
    out.push(...this.blocks(rest));
    return out;
  }

  // ───────────────────────── inline level ─────────────────────────

  private inline(nodes: PhrasingContent[], marks: Marks): Item[] {
    // ==highlight== can span formatting nodes, so its state lives across one whole inline sequence.
    if (this.inlineDepth === 0) this.highlightOn = false;
    this.inlineDepth++;
    try {
      const out: Item[] = [];
      for (const node of nodes) out.push(...this.phrasing(node, marks));
      return out;
    } finally {
      this.inlineDepth--;
    }
  }

  private phrasing(node: PhrasingContent, marks: Marks): Item[] {
    switch (node.type) {
      case "text":
        return this.textItems(node.value, marks);
      case "emphasis":
        return this.inline(node.children, { ...marks, italic: true });
      case "strong":
        return this.inline(node.children, { ...marks, bold: true });
      case "delete":
        return this.inline(node.children, { ...marks, strike: true });
      case "inlineCode":
        return [{ text: node.value, code: true }];
      case "break":
        return [{ break: true }];
      case "link":
        return this.link(node.url, node.children, marks);
      case "image":
        return this.markdownImage(node.url, node.alt ?? undefined);
      case "linkReference":
      case "imageReference":
        return node.type === "linkReference"
          ? this.inline(node.children, marks)
          : [{ text: node.alt ?? "", ...applyMarks(marks) }];
      case "html":
        return [{ text: node.value, ...applyMarks(marks) }];
      case "footnoteReference":
        this.warn("degraded", "Footnotes are not supported and were published as plain text");
        return [{ text: `[${node.label ?? node.identifier}]`, ...applyMarks(marks) }];
      default:
        return [];
    }
  }

  private link(url: string, children: PhrasingContent[], marks: Marks): Item[] {
    if (/^(https?:|mailto:)/i.test(url)) {
      return this.inline(children, { ...marks, link: url });
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      this.warn("unsupported-link", `Link scheme not supported: ${url}`);
      return this.inline(children, marks);
    }
    // A relative markdown link, e.g. [text](Other%20Note.md): treat it like a wikilink to a note.
    const path = decodeURIComponent(url.split("#")[0]).replace(/\.md$/i, "");
    const target = path ? this.ctx.resolveNote(path) : null;
    if (target) return [{ mention: { resourceId: target.resourceId } }];
    if (path) this.warn("unresolved-link", `Unresolved link: ${path}`, path);
    return this.inline(children, marks);
  }

  private markdownImage(url: string, alt: string | undefined): Item[] {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      this.warn("unsupported-embed", `External image was removed: ${url}`);
      return [];
    }
    return this.assetItem(decodeURIComponent(url), alt);
  }

  private textItems(value: string, marks: Marks): Item[] {
    const out: Item[] = [];
    // Walk the string, splitting out wikilink tokens and ==highlight== toggles.
    const re = new RegExp(`${TOKEN_RE.source}|==`, "g");
    let last = 0;
    const emit = (text: string) => {
      if (!text) return;
      const m: Marks = this.highlightOn ? { ...marks, highlight: HIGHLIGHT_COLOR } : marks;
      // Newlines inside a paragraph are line breaks.
      text.split("\n").forEach((part, i) => {
        if (i > 0) out.push({ break: true });
        if (part) out.push({ text: part, ...applyMarks(m) });
      });
    };
    for (let m = re.exec(value); m; m = re.exec(value)) {
      emit(value.slice(last, m.index));
      last = m.index + m[0].length;
      if (m[0] === "==") {
        // "a == b" is a comparison, not a highlight delimiter.
        const spaced = /\s/.test(value[m.index - 1] ?? "") && /\s/.test(value[m.index + 2] ?? "");
        if (spaced) emit("==");
        else this.highlightOn = !this.highlightOn;
      } else {
        out.push(...this.wikiToken(this.tokens[Number(m[1])], marks));
      }
    }
    emit(value.slice(last));
    return out;
  }

  private wikiToken(token: WikiToken | undefined, marks: Marks): Item[] {
    if (!token) return [];
    const label =
      token.alias ?? (token.heading ? `${token.target} > ${token.heading}` : token.target);
    const textRun = (): Item[] => (label ? [{ text: label, ...applyMarks(marks) }] : []);

    if (token.embed) {
      const ext = extOf(token.target);
      if (IMAGE_EXT.has(ext)) return this.assetItem(token.target, undefined);
      if (OTHER_ATTACHMENT_EXT.has(ext)) {
        this.warn("unsupported-embed", `Embedded file type is not supported: ${token.target}`);
        return [];
      }
      // Note transclusion: degrade to a mention of the target.
      this.warn("transclusion", `Transclusion is not supported: ![[${token.target}]]`);
      const target = this.ctx.resolveNote(token.target);
      return target ? [{ mention: { resourceId: target.resourceId } }] : textRun();
    }

    if (!token.target) return textRun(); // [[#Heading]] within the same note
    const target = this.ctx.resolveNote(token.target);
    if (!target) {
      this.warn("unresolved-link", `Unresolved link: ${token.target}`, token.target);
      return textRun();
    }
    // The label belongs inside the mention object; the Run schema rejects any other key beside `mention`.
    return [
      loose<Run>({
        mention: { resourceId: target.resourceId, ...(token.alias ? { text: token.alias } : {}) },
      }),
    ];
  }

  private assetItem(linkpath: string, alt: string | undefined): Item[] {
    const ext = extOf(linkpath);
    if (!IMAGE_EXT.has(ext)) {
      this.warn("unsupported-embed", `Embedded file type is not supported: ${linkpath}`);
      return [];
    }
    const asset = this.ctx.resolveAsset(linkpath);
    if (!asset) {
      this.warn("missing-image", `Image not found: ${linkpath}`);
      return [];
    }
    return [{ image: { url: asset.url, ...(alt ? { alt } : {}) } }];
  }
}

function applyMarks(marks: Marks): Partial<Run> {
  return loose<Partial<Run>>({
    ...(marks.bold ? { bold: true } : {}),
    ...(marks.italic ? { italic: true } : {}),
    ...(marks.strike ? { strike: true } : {}),
    ...(marks.link ? { link: marks.link } : {}),
    ...(marks.highlight ? { highlight: marks.highlight } : {}),
  });
}

/** Drop empty runs, strip marks from code runs, and merge neighbours with identical marks. */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const raw of runs) {
    let run = raw;
    if ("text" in run) {
      if (run.text === "") continue;
      if (run.code) run = { text: run.text, code: true };
      const prev = out[out.length - 1];
      if (prev && "text" in prev && !prev.code && !run.code && sameMarks(prev, run)) {
        out[out.length - 1] = { ...prev, text: prev.text + run.text };
        continue;
      }
    }
    out.push(run);
  }
  return out;
}

function sameMarks(a: Run, b: Run): boolean {
  const strip = (r: Run) => {
    const { text: _text, ...marks } = loose<Record<string, unknown>>(r);
    return JSON.stringify(Object.entries(marks).sort(([x], [y]) => x.localeCompare(y)));
  };
  return strip(a) === strip(b);
}
