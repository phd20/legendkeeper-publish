import { describe, expect, it } from "vitest";
import { convertFolder, stripFrontmatter } from "../../src/convert";
import { convert, settings } from "./helpers";

describe("resource fields", () => {
  it("uses the basename by default and frontmatter title when present", () => {
    expect(convert("x", { basename: "aldric" }).fields.name).toBe("aldric");
    expect(convert("x", { basename: "aldric", frontmatter: { title: "Aldric the Bold" } }).fields.name).toBe(
      "Aldric the Bold",
    );
  });

  it("strips # from tags, dedupes, and keeps nested tags literal", () => {
    const { fields } = convert("x", { tags: ["#place/city", "place/city", "#npc"] });
    expect(fields.tags).toEqual(["place/city", "npc"]);
  });

  it("reads aliases from a list or a comma string", () => {
    expect(convert("x", { frontmatter: { aliases: ["A", "B"] } }).fields.aliases).toEqual(["A", "B"]);
    expect(convert("x", { frontmatter: { aliases: "A, B" } }).fields.aliases).toEqual(["A", "B"]);
  });

  it("maps icon, color and shape, and rejects invalid values with warnings", () => {
    const ok = convert("x", { frontmatter: { "lk-icon": "crown", "lk-color": "#c49454", "lk-shape": "shield" } });
    expect(ok.fields).toMatchObject({ iconGlyph: "crown", iconColor: "#C49454", iconShape: "shield" });
    const bad = convert("x", { frontmatter: { "lk-color": "red", "lk-shape": "blob" } });
    expect(bad.fields.iconColor).toBeUndefined();
    expect(bad.fields.iconShape).toBeUndefined();
    expect(bad.warnings.filter((w) => w.kind === "invalid-field")).toHaveLength(2);
  });

  it("sets the parent id", () => {
    expect(convert("x").fields.parentId).toBe("mount0001");
  });
});

describe("hidden handling", () => {
  it("defaults to the setting", () => {
    expect(convert("x", { settings: { hiddenByDefault: true } }).fields.isHidden).toBe(true);
    expect(convert("x").fields.isHidden).toBe(false);
  });

  it("lets the frontmatter key override the default both ways", () => {
    const on = { settings: { hiddenByDefault: true }, frontmatter: { "lk-hidden": false } };
    expect(convert("x", on).fields.isHidden).toBe(false);
    expect(convert("x", { frontmatter: { "lk-hidden": true } }).fields.isHidden).toBe(true);
  });

  it("honours a custom hidden key", () => {
    const o = { settings: { hiddenKey: "gm-only" }, frontmatter: { "gm-only": true, "lk-hidden": false } };
    expect(convert("x", o).fields.isHidden).toBe(true);
  });
});

describe("folder pages", () => {
  it("builds an untitled children collection", () => {
    const { fields, blocks } = convertFolder(
      { name: "Places", path: "Places", resourceId: "places01", parentId: "mount0001" },
      settings,
    );
    expect(fields).toMatchObject({ name: "Places", parentId: "mount0001", isHidden: false });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "resourceCollection", isTitleHidden: true });
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading YAML block only", () => {
    expect(stripFrontmatter("---\ntitle: A\n---\nBody\n---\nnot fm")).toBe("Body\n---\nnot fm");
    expect(stripFrontmatter("No frontmatter")).toBe("No frontmatter");
  });
});
