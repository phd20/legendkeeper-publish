import { describe, expect, it } from "vitest";
import { refineLinkWarnings } from "../../src/publish/warnings";
import type { Warning } from "../../src/convert/types";

const unresolved = (link: string): Warning => ({ kind: "unresolved-link", message: `Unresolved link: ${link}`, link });

describe("refineLinkWarnings", () => {
  const keys: Record<string, string> = { Oakhaven: "Places/Cities/Oakhaven.md", Lore: "Lore" };
  const refine = (warnings: Warning[], published: string[] = []) =>
    refineLinkWarnings(warnings, (l) => keys[l], (k) => published.includes(k));

  it("rewords a link to a note that is about to be published", () => {
    const [w] = refine([unresolved("Oakhaven")]);
    expect(w.kind).toBe("pending-link");
    expect(w.message).toMatch(/not published yet/);
    expect(w.message).not.toMatch(/Unresolved/);
  });

  it("keeps the plain warning for a link that will never resolve", () => {
    expect(refine([unresolved("Secret Plans")])).toEqual([unresolved("Secret Plans")]);
  });

  it("keeps the warning when the target is already published but the link still failed", () => {
    expect(refine([unresolved("Oakhaven")], ["Places/Cities/Oakhaven.md"])).toEqual([unresolved("Oakhaven")]);
  });

  it("leaves other warnings untouched", () => {
    const other: Warning = { kind: "degraded", message: "Mermaid diagrams are not rendered" };
    expect(refine([other, unresolved("Lore")]).map((w) => w.kind)).toEqual(["degraded", "pending-link"]);
  });
});
