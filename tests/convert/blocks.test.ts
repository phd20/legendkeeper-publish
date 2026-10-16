import { describe, expect, it } from "vitest";
import { outputHash } from "../../src/convert";
import { convert } from "./helpers";

describe("block structure", () => {
  it("is deterministic", async () => {
    const a = convert("# Hi\n\nSome **text**.");
    const b = convert("# Hi\n\nSome **text**.");
    expect(a).toEqual(b);
    expect(await outputHash(a)).toBe(await outputHash(b));
  });

  it("maps headings and paragraphs", () => {
    const { blocks } = convert("## Title\n\nHello world");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, content: [{ text: "Title" }] },
      { kind: "paragraph", content: [{ text: "Hello world" }] },
    ]);
  });

  it("nests an ordered list inside a bullet list item", () => {
    const { blocks } = convert("- one\n  1. a\n  2. b\n- two");
    expect(blocks).toHaveLength(1);
    const list = blocks[0] as any;
    expect(list.kind).toBe("bulletList");
    expect(list.children[0].kind).toBe("listItem");
    expect(list.children[0].children[0].kind).toBe("paragraph");
    expect(list.children[0].children[1].kind).toBe("orderedList");
    expect(list.children[1].children[0].content).toEqual([{ text: "two" }]);
  });

  it("maps task lists with checked states", () => {
    const { blocks } = convert("- [x] Done\n- [ ] Todo");
    expect(blocks).toEqual([
      {
        kind: "taskList",
        children: [
          { kind: "taskItem", checked: true, content: [{ text: "Done" }] },
          { kind: "taskItem", checked: false, content: [{ text: "Todo" }] },
        ],
      },
    ]);
  });

  it("flags the first table row as header cells", () => {
    const { blocks } = convert("| a | b |\n|---|---|\n| 1 | 2 |");
    const table = blocks[0] as any;
    expect(table.kind).toBe("table");
    expect(table.children[0].children.every((c: any) => c.header === true)).toBe(true);
    expect(table.children[1].children.every((c: any) => c.header === undefined)).toBe(true);
    expect(table.children[1].children[0].children[0].content).toEqual([{ text: "1" }]);
  });

  it("keeps fenced code verbatim with its language", () => {
    const { blocks } = convert("```ts\nconst x = [[not a link]];\n```");
    expect(blocks).toEqual([{ kind: "code", language: "ts", text: "const x = [[not a link]];" }]);
  });

  it("maps quotes and rules", () => {
    const { blocks } = convert("> quoted\n\n---");
    expect(blocks[0]).toMatchObject({ kind: "quote" });
    expect(blocks[1]).toEqual({ kind: "rule" });
  });
});

describe("inline marks", () => {
  it("maps bold, italic, strike, code and highlight", () => {
    const { blocks } = convert("**b** *i* ~~s~~ `c` ==h==");
    const runs = (blocks[0] as any).content;
    expect(runs).toContainEqual({ text: "b", bold: true });
    expect(runs).toContainEqual({ text: "i", italic: true });
    expect(runs).toContainEqual({ text: "s", strike: true });
    expect(runs).toContainEqual({ text: "c", code: true });
    expect(runs.find((r: any) => r.text === "h").highlight).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("code runs carry no other marks", () => {
    const { blocks } = convert("**`x`**");
    expect((blocks[0] as any).content).toEqual([{ text: "x", code: true }]);
  });

  it("keeps http links as link marks", () => {
    const { blocks } = convert("[site](https://example.com)");
    expect((blocks[0] as any).content).toEqual([{ text: "site", link: "https://example.com" }]);
  });

  it("turns unsupported link schemes into plain text with a warning", () => {
    const { blocks, warnings } = convert("[x](obsidian://open?vault=a)");
    expect((blocks[0] as any).content).toEqual([{ text: "x" }]);
    expect(warnings.map((w) => w.kind)).toContain("unsupported-link");
  });

  it("turns newlines into break runs", () => {
    const { blocks } = convert("one\ntwo");
    expect((blocks[0] as any).content).toEqual([{ text: "one" }, { break: true }, { text: "two" }]);
  });
});

describe("wikilinks", () => {
  const notes = { "Aldric the Bold": "aldric01", Pantheon: "pantheo1", B: "bbbbbbb1" };

  it("converts an aliased link to a mention with text", () => {
    const { blocks } = convert("See [[Aldric the Bold|the king]].", { notes });
    expect((blocks[0] as any).content).toEqual([
      { text: "See " },
      { mention: { resourceId: "aldric01", text: "the king" } },
      { text: "." },
    ]);
  });

  it("drops heading anchors", () => {
    const { blocks } = convert("[[Aldric the Bold#Early life]]", { notes });
    expect((blocks[0] as any).content).toEqual([{ mention: { resourceId: "aldric01" } }]);
  });

  it("falls back to plain text with a warning for unpublished targets", () => {
    const { blocks, warnings } = convert("Plans: [[Secret Plans]]", { notes });
    expect((blocks[0] as any).content).toEqual([{ text: "Plans: Secret Plans" }]);
    expect(warnings).toEqual([{ kind: "unresolved-link", message: "Unresolved link: Secret Plans", link: "Secret Plans" }]);
  });

  it("is not confused by underscores or pipes inside tables", () => {
    const { blocks } = convert("| a |\n|---|\n| [[B|bee_bee_]] |", { notes });
    const cell = (blocks[0] as any).children[1].children[0].children[0];
    expect(cell.content).toEqual([{ mention: { resourceId: "bbbbbbb1", text: "bee_bee_" } }]);
  });

  it("does not touch wikilinks inside inline code", () => {
    const { blocks } = convert("`[[B]]`", { notes });
    expect((blocks[0] as any).content).toEqual([{ text: "[[B]]", code: true }]);
  });

  it("degrades transclusions to a mention with a warning", () => {
    const { blocks, warnings } = convert("![[Pantheon]]", { notes });
    expect((blocks[0] as any).content).toEqual([{ mention: { resourceId: "pantheo1" } }]);
    expect(warnings[0].kind).toBe("transclusion");
  });

  it("resolves markdown links to notes", () => {
    const { blocks } = convert("[b](B.md)", { notes });
    expect((blocks[0] as any).content).toEqual([{ mention: { resourceId: "bbbbbbb1" } }]);
  });
});

describe("callouts, secrets and comments", () => {
  it("maps callouts to tone with a bold title", () => {
    const { blocks } = convert("> [!warning] Beware\n> The bridge is out.");
    expect(blocks).toEqual([
      {
        kind: "callout",
        tone: "warning",
        children: [
          { kind: "paragraph", content: [{ text: "Beware", bold: true }] },
          { kind: "paragraph", content: [{ text: "The bridge is out." }] },
        ],
      },
    ]);
  });

  it("defaults unknown callout types to note", () => {
    const { blocks } = convert("> [!whatever]\n> hi");
    expect((blocks[0] as any).tone).toBe("note");
  });

  it("maps [!secret] to a secret block", () => {
    const { blocks } = convert("> [!secret]\n> The duke is a vampire.");
    expect(blocks).toEqual([
      { kind: "secret", children: [{ kind: "paragraph", content: [{ text: "The duke is a vampire." }] }] },
    ]);
  });

  it("strips comments entirely", () => {
    const { blocks } = convert("Hello %%todo fix%% world");
    expect((blocks[0] as any).content).toEqual([{ text: "Hello  world" }]);
  });

  it("strips multi-line comments but not comment markers in code fences", () => {
    const { blocks } = convert("a\n\n%%\nhidden\nlines\n%%\n\nb\n\n```\n%%keep%%\n```");
    expect(blocks).toHaveLength(3);
    expect((blocks[2] as any).text).toBe("%%keep%%");
  });
});

describe("images and attachments", () => {
  const images = { "map.png": "https://assets/map.png", "pic.jpg": "https://assets/pic.jpg" };

  it("splits wikilink images out of paragraphs and ignores size hints", () => {
    const { blocks } = convert("before ![[map.png|400]] after", { images });
    expect(blocks).toEqual([
      { kind: "paragraph", content: [{ text: "before " }] },
      { kind: "image", url: "https://assets/map.png" },
      { kind: "paragraph", content: [{ text: " after" }] },
    ]);
  });

  it("handles markdown image syntax with alt text", () => {
    const { blocks } = convert("![A map](pic.jpg)", { images });
    expect(blocks).toEqual([{ kind: "image", url: "https://assets/pic.jpg", alt: "A map" }]);
  });

  it("omits unsupported attachments with a warning", () => {
    const { blocks, warnings } = convert("![[handout.pdf]]\n\n![[logo.svg]]", { images });
    expect(blocks).toEqual([]);
    expect(warnings.map((w) => w.kind)).toEqual(["unsupported-embed", "unsupported-embed"]);
  });

  it("warns about missing images", () => {
    const { blocks, warnings } = convert("![[gone.png]]", { images });
    expect(blocks).toEqual([]);
    expect(warnings[0].kind).toBe("missing-image");
  });
});

describe("degraded syntax", () => {
  it("turns display math into a code block with a warning", () => {
    const { blocks, warnings } = convert("$$\nx^2\n$$");
    expect(blocks).toEqual([{ kind: "code", language: "latex", text: "x^2" }]);
    expect(warnings[0].kind).toBe("degraded");
  });

  it("warns for mermaid and dataview but keeps the code", () => {
    const { blocks, warnings } = convert("```mermaid\ngraph TD\n```\n\n```dataview\nLIST\n```");
    expect(blocks.map((b: any) => b.language)).toEqual(["mermaid", "dataview"]);
    expect(warnings).toHaveLength(2);
  });

  it("degrades footnotes to plain paragraphs", () => {
    const { blocks, warnings } = convert("Text[^1]\n\n[^1]: The note.");
    expect(warnings.some((w) => w.kind === "degraded")).toBe(true);
    expect(JSON.stringify(blocks)).toContain("The note.");
  });
});

describe("highlight spanning formatting", () => {
  it("keeps ==highlight== across nested marks and stops at the closing delimiter", () => {
    const { blocks } = convert("A ==high **lit**== end.");
    const runs = (blocks[0] as any).content;
    expect(runs.map((r: any) => [r.text, !!r.highlight, !!r.bold])).toEqual([
      ["A ", false, false],
      ["high ", true, false],
      ["lit", true, true],
      [" end.", false, false],
    ]);
  });

  it("does not treat a spaced == as a delimiter", () => {
    const { blocks } = convert("if a == b then c");
    expect((blocks[0] as any).content).toEqual([{ text: "if a == b then c" }]);
  });

  it("merges a bold callout title into a single run", () => {
    const { blocks } = convert("> [!note] Plain **bold** end\n> body");
    expect((blocks[0] as any).children[0].content).toEqual([{ text: "Plain bold end", bold: true }]);
  });
});
