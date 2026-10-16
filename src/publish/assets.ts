import { PENDING_ASSET_PREFIX, type Block } from "../convert/types";

/** Hashes of images that a block tree still references by placeholder URL. */
export function collectPendingAssets(blocks: Block[]): string[] {
  const found = new Set<string>();
  walk(blocks, (node) => {
    if (node.kind === "image" && typeof node.url === "string" && node.url.startsWith(PENDING_ASSET_PREFIX)) {
      found.add(node.url.slice(PENDING_ASSET_PREFIX.length));
    }
  });
  return [...found];
}

/** A copy of the block tree with placeholder image URLs replaced by uploaded asset URLs. */
export function substituteAssets(blocks: Block[], urlByHash: ReadonlyMap<string, string>): Block[] {
  const copy = structuredClone(blocks);
  walk(copy, (node) => {
    if (node.kind === "image" && typeof node.url === "string" && node.url.startsWith(PENDING_ASSET_PREFIX)) {
      const url = urlByHash.get(node.url.slice(PENDING_ASSET_PREFIX.length));
      if (url) node.url = url;
    }
  });
  return copy;
}

type Node = { kind?: string; url?: unknown; children?: unknown };

function walk(blocks: unknown, visit: (node: Node) => void): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks as Node[]) {
    visit(block);
    walk(block.children, visit);
  }
}
