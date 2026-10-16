import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

describe("manifest", () => {
  it("matches the spec'd plugin identity and minimum version", () => {
    expect(manifest.id).toBe("legendkeeper-publish");
    expect(manifest.minAppVersion).toBe("1.11.4");
    expect(manifest.isDesktopOnly).toBe(false);
  });
});
