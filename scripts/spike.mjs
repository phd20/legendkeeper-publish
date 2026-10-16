// Live checks for tasks 2.3-2.5 and design open question O6. Run: node scripts/spike.mjs
// Reads the API key from LK_API_KEY or the git-ignored file .lk-api-key. Touches only a "lk-spike" page it
// creates at the top level of the connected project, and moves it to the trash at the end.
import { readFileSync } from "node:fs";
import { LegendKeeper } from "@legendkeeper/sdk";
import { createId } from "@paralleldrive/cuid2";

const apiKey = process.env.LK_API_KEY ?? readFileSync(new URL("../.lk-api-key", import.meta.url), "utf8").trim();
const lk = new LegendKeeper({ apiKey });
const id = () => createId();
const report = (label, value) => console.log(`${label}:`, typeof value === "string" ? value : JSON.stringify(value));
const attempt = async (label, fn) => {
  try { return await fn(); } catch (e) { report(`${label} FAILED`, `${e.status ?? ""} ${e.code ?? ""} ${e.message}`); }
};

const project = await lk.project();
report("project", project.name);

const rootId = id();
await lk.resources.createMany({ resources: [{ id: rootId, name: "lk-spike" }] });
try {
  // O3: a mention to a page created in the same batch, and O2/O6 setup.
  const [aId, bId, hiddenParent, hiddenChild] = [id(), id(), id(), id()];
  const created = await lk.resources.createMany({
    resources: [
      { id: aId, name: "Spike A", parentId: rootId },
      { id: bId, name: "Spike B", parentId: rootId },
      { id: hiddenParent, name: "Hidden parent", parentId: rootId, isHidden: true },
      { id: hiddenChild, name: "Visible child", parentId: hiddenParent },
    ],
  });
  const docA = created.resources[0].documents[0].id;
  const docB = created.resources[1].documents[0].id;

  // O3
  const written = await attempt("O3 write mention to same-run page", () =>
    lk.documents.replaceBlocks({ resourceId: aId, documentId: docA }, {
      blocks: [{ kind: "paragraph", content: [{ text: "See " }, { mention: { resourceId: bId } }] }],
    }));
  report("O3 mention accepted", !!written);

  // O1: which read returns the version
  const blocks = await lk.documents.getBlocks({ resourceId: aId, documentId: docA });
  report("O1 getBlocks version", blocks.version);
  report("O1 matches write version", blocks.version === written?.version);
  const doc = await attempt("O1 getDocument", () => lk.documents.get({ resourceId: aId, documentId: docA }));
  report("O1 getDocument has version", doc ? "version" in doc : false);

  // 412 behaviour with a stale If-Match
  await attempt("412 check", () => lk.documents.replaceBlocks({ resourceId: aId, documentId: docA }, { blocks: [], ifMatch: "stale" }))
    .then((r) => r !== undefined && report("412 check", "UNEXPECTED success"));

  // O6: folder-style collection filtered by parentId
  const docRoot = (await lk.resources.get({ resourceId: rootId })).documents[0].id;
  const col = await attempt("O6 write collection filter", () =>
    lk.documents.replaceBlocks({ resourceId: rootId, documentId: docRoot }, {
      blocks: [{ kind: "resourceCollection", isTitleHidden: true,
        filter: { type: "filter", id: "kids", filterType: "field", field: "parentId", operator: "equals", value: rootId } }],
    }));
  report("O6 collection accepted", !!col);

  // O2: is a child of a hidden parent itself hidden?
  const child = await lk.resources.get({ resourceId: hiddenChild });
  report("O2 child isHidden when parent hidden", child.isHidden);

  // Admin check: can this key create hidden pages at all? (it just did if we got here)
  report("admin key (hidden create worked)", true);
} finally {
  await lk.resources.delete({ resourceId: rootId }, { cascade: true });
  report("cleanup", "lk-spike moved to trash");
}
