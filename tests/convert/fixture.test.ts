import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convertNote, stripFrontmatter, PENDING_ASSET_PREFIX } from "../../src/convert";
import { settings } from "./helpers";

const vault = join(__dirname, "../fixtures/vault");
const read = (path: string) => stripFrontmatter(readFileSync(join(vault, path), "utf8"));

const published: Record<string, string> = {
  Oakhaven: "oakhav01",
  Lore: "loreid01",
  Keep: "keepid01",
  "Aldric the Bold": "aldric01",
  Aldric: "aldric01",
};

function run_(path: string, frontmatter: Record<string, unknown> = {}) {
  return convertNote(
    { path, basename: path.split("/").pop()!.replace(/\.md$/, ""), body: read(path), frontmatter, tags: [], parentId: "mount001" },
    settings,
    {
      resolveNote: (p) => (published[p] ? { resourceId: published[p] } : null),
      resolveAsset: (p) => (p === "crest.png" ? { url: `${PENDING_ASSET_PREFIX}abc123` } : null),
    },
  );
}

const TEXT_KEYS = new Set(["text", "bold", "italic", "underline", "strike", "code", "link", "sub", "sup", "color", "highlight"]);
const MENTION_KEYS = new Set(["mention", "color", "highlight"]);

function runsOf(node: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(node)) node.forEach((n) => runsOf(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.content)) out.push(...(o.content as Array<Record<string, unknown>>));
    runsOf(o.children, out);
  }
  return out;
}

describe("fixture vault", () => {
  it("emits only run keys the LegendKeeper API accepts", () => {
    for (const path of ["Home.md", "Lore/Aldric the Bold.md", "Places/Keep.md", "Places/Cities/Oakhaven.md"]) {
      for (const run of runsOf(run_(path).blocks)) {
        const keys = Object.keys(run);
        const allowed = "mention" in run ? MENTION_KEYS : "break" in run ? new Set(["break"]) : TEXT_KEYS;
        expect(keys.filter((k) => !allowed.has(k)), `${path}: ${JSON.stringify(run)}`).toEqual([]);
        if ("mention" in run) expect(Object.keys(run.mention as object).every((k) => ["resourceId", "documentId", "text", "name"].includes(k))).toBe(true);
      }
    }
  });

  it("converts Home with mentions, a callout, and no trace of the GM comment", () => {
    const { blocks, warnings } = run_("Home.md");
    const json = JSON.stringify(blocks);
    expect(json).toContain('"mention":{"resourceId":"oakhav01","text":"the capital"}');
    expect(json).toContain('"mention":{"resourceId":"loreid01"}');
    expect(json).not.toContain("GM reminder");
    expect(blocks.some((b) => b.kind === "callout")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("converts Aldric with a secret block, table, task list and pending image", () => {
    const { blocks, warnings } = run_("Lore/Aldric the Bold.md");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "secret", "table", "taskList", "image"]);
    expect((blocks[4] as unknown as { url: string }).url).toBe(`${PENDING_ASSET_PREFIX}abc123`);
    expect(warnings).toEqual([]);
  });

  it("warns for the unsupported handout and for mermaid, as the fixture README says", () => {
    expect(run_("Places/Cities/Oakhaven.md").warnings.map((w) => w.kind)).toEqual(["unsupported-embed"]);
    const keep = run_("Places/Keep.md");
    expect(keep.warnings.map((w) => w.kind)).toEqual(["degraded"]);
    expect(keep.blocks.at(-1)).toMatchObject({ kind: "code", language: "mermaid" });
  });

  it("degrades a link to an excluded note to plain text with a warning", () => {
    const { blocks, warnings } = convertNote(
      { path: "Home.md", basename: "Home", body: "See [[Secret Plans]].", frontmatter: {}, tags: [], parentId: "m" },
      settings,
      { resolveNote: () => null, resolveAsset: () => null },
    );
    expect(JSON.stringify(blocks)).toContain("See Secret Plans.");
    expect(warnings[0].kind).toBe("unresolved-link");
  });
});
