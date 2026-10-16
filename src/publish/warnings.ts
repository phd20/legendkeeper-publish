import type { Warning } from "../convert/types";

/**
 * At review time nothing new exists in LegendKeeper yet, so a link to a note that is about to be published
 * looks unresolved. Reword those so they say what will actually happen, and keep the plain "unresolved"
 * warning for links to notes that will not be published at all (excluded or missing).
 *
 * @param keyForLink the manifest key the link's target would publish under, or undefined if it never will
 * @param published  keys already in the manifest
 */
export function refineLinkWarnings(
  warnings: Warning[],
  keyForLink: (link: string) => string | undefined,
  published: (key: string) => boolean,
): Warning[] {
  return warnings.map((warning) => {
    if (warning.kind !== "unresolved-link" || !warning.link) return warning;
    const key = keyForLink(warning.link);
    if (key === undefined || published(key)) return warning;
    return {
      kind: "pending-link",
      link: warning.link,
      message: `"${warning.link}" is not published yet. This link works once it is published in the same run or earlier.`,
    };
  });
}
