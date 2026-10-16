export interface WikiToken {
  embed: boolean;
  target: string;
  heading?: string;
  alias?: string;
}

export interface Prepared {
  text: string;
  tokens: WikiToken[];
}

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** Remove a leading YAML frontmatter block, if any. */
export function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER, "");
}

export const TOKEN_OPEN = "";
export const TOKEN_CLOSE = "";
export const TOKEN_RE = /(\d+)/g;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

// Inline code spans pass through untouched; comments vanish; wikilinks become opaque tokens.
const PROTECT =
  /(`+)[\s\S]*?(?<!`)\1(?!`)|%%[\s\S]*?%%|(!?)\[\[([^\]\n]+?)\]\]/g;

function parseWikilink(embed: boolean, inner: string): WikiToken {
  const [targetPart, ...aliasParts] = inner.replace(/\\\|/g, "|").split("|");
  const alias = aliasParts.length > 0 ? aliasParts.join("|").trim() : undefined;
  const hashAt = targetPart.indexOf("#");
  let target = hashAt >= 0 ? targetPart.slice(0, hashAt) : targetPart;
  const heading = hashAt >= 0 ? targetPart.slice(hashAt + 1).trim() : undefined;
  const caretAt = target.indexOf("^");
  if (caretAt >= 0) target = target.slice(0, caretAt);
  return {
    embed,
    target: target.trim(),
    heading: heading || undefined,
    alias: alias || undefined,
  };
}

function protectSegment(segment: string, tokens: WikiToken[]): string {
  return segment.replace(
    PROTECT,
    (match: string, ticks: string | undefined, bang: string | undefined, inner: string | undefined) => {
      if (ticks) return match;
      if (inner === undefined) return ""; // %%comment%%
      tokens.push(parseWikilink(bang === "!", inner));
      return `${TOKEN_OPEN}${tokens.length - 1}${TOKEN_CLOSE}`;
    },
  );
}

/**
 * Strip %%comments%% and replace [[wikilinks]] / ![[embeds]] with opaque tokens so the markdown
 * parser cannot mangle them. Fenced code blocks and inline code spans are left untouched.
 */
export function prepareBody(body: string): Prepared {
  const tokens: WikiToken[] = [];
  const out: string[] = [];
  let buffer: string[] = [];
  let fence: { char: string; len: number } | null = null;

  const flush = () => {
    if (buffer.length > 0) {
      out.push(protectSegment(buffer.join("\n"), tokens));
      buffer = [];
    }
  };

  for (const line of body.split(/\r?\n/)) {
    const m = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && /^\s*$/.test(line.slice(m[0].length))) {
        fence = null;
      }
    } else if (m) {
      flush();
      fence = { char: m[1][0], len: m[1].length };
      out.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return { text: out.join("\n"), tokens };
}
