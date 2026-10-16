## Context

The workspace is empty: this change creates the plugin from the `obsidian-sample-plugin` template. The target is LegendKeeper's v3 REST API (`https://www.legendkeeper.com/api/v3`, OpenAPI at `/api/v3/openapi.json`) and its TypeScript SDK `@legendkeeper/sdk`.

Facts about the API that shape the design:

- **Model.** A project is a tree of *resources* (`parentId` + string `rank`). A resource has 1–5 *documents*; a `page` document is a typed block tree (paragraph, heading, list, table, callout, secret, image, collection, …). Inline text is an array of *runs*: text with marks, a `mention { resourceId, documentId?, text? }`, or a line break. There is **no markdown import** — the plugin must convert.
- **Identity.** `createResource` accepts a client-chosen cuid2 id (8 or 24 chars, lowercase letter first). An id is "taken" forever, including by trashed resources.
- **Writes.** `PUT …/docs/{id}/blocks` replaces a page wholesale; unsupported content survives only if echoed by id. Every block write returns the document `version` (also `ETag`); `If-Match` makes a stale write fail with `412 VERSION_MISMATCH`.
- **Images.** `createImageUpload` → `PUT` bytes to a signed URL → `createImageAsset` → asset `url`. Only `image/jpeg|png|gif|webp`. Image blocks accept only this project's asset URLs.
- **Limits.** Writes: 120/min, 3,000/h per key. All requests: 300/min, 6,000/h, 60,000/day per key; 12,000/h per project. `429` carries `Retry-After`. `createMany` takes ≤100 resources.
- **Auth.** Bearer project API key; owner must be on a paid plan. Only admins may set `isHidden`; the API exposes no way to ask a key for its role.
- **Deletes** are soft (trash, restorable). Deleting a resource with live children answers `409 HAS_CHILDREN` unless `cascade=true`.
- **SDK.** Zero runtime dependencies, needs a `fetch`; the client accepts a custom `fetch` option. It ships block builders (`p`, `h`, `mention`, `collection`, `withId`, …).

On the Obsidian side: `requestUrl` bypasses CORS and works on mobile; `app.secretStorage` (1.11.4+) stores secrets outside `data.json` and does not sync between devices; `metadataCache` provides frontmatter, tags, links, embeds and link resolution.

## Goals / Non-Goals

**Goals:**
- Publish a vault (or a subset) to one LegendKeeper project, under one mount-point resource, one-way.
- Detect exactly which notes would change on LegendKeeper and let the user choose in a review modal before anything is written.
- Keep stable LegendKeeper identity across renames and moves.
- Never overwrite a LegendKeeper-side page edit without explicit consent; never publish GM-only content visibly.
- Meet community-plugin guidelines: no secrets in `data.json`, mobile-compatible, no "Obsidian" in the plugin name.

**Non-Goals:**
- Two-way sync or importing LegendKeeper content into the vault.
- Adopting resources that the plugin did not create (no name matching).
- Mapping arbitrary frontmatter properties to infoboxes or sidebar properties (v2 candidate).
- Note transclusion, footnotes, math, Mermaid, Dataview rendering (they degrade with a warning).
- Per-note text diffs in the review modal.
- Maps, timelines, boards.
- An "Open in LegendKeeper" command (deferred until the web URL format is known).

## Decisions

### D1. Architecture: pure core, thin Obsidian and network shells

```
src/
  main.ts            Plugin lifecycle, commands, ribbon, status bar, vault event wiring
  settings/          Settings types, defaults, SettingTab (SecretComponent, pickers)
  lk/                SDK client factory, requestUrl→fetch adapter, write pacer, id minting
  convert/           PURE: markdown + frontmatter → { resourceFields, blocks, warnings, links }
  tracking/          Manifest store, candidate scan, output hashing (+ mtime cache),
                     PURE planner: (candidates, manifest) → classified change set
  review/            ReviewModal (renders a change set, returns the selection)
  publish/           Executor: selection → ordered operations → API calls → manifest updates
```

`convert/` and the planner in `tracking/` import nothing from `obsidian` or the network. Vault access, link resolution and API calls are injected as small interfaces, so vitest can run them against a fixture vault.

*Alternative considered:* converting through Obsidian's rendered HTML (`MarkdownRenderer`) and mapping the DOM to blocks. Rejected: it needs a live DOM, which makes tests hard; plugin post-processors would leak into the output; and wikilinks become anchors that lose resolution info.

### D2. Markdown parsing with mdast plus Obsidian extensions

Use `mdast-util-from-markdown` with the GFM extensions (tables, task lists, strikethrough, autolinks), plus small micromark extensions or pre-passes for Obsidian syntax:
- `[[wikilinks]]` and `![[embeds]]`, including `#heading`, `^block` and `|alias`
- `==highlight==`
- `%%comments%%`, stripped before parsing
- callouts: a blockquote whose first line is `[!type]`, with an optional `+`/`-` fold marker

Link targets are resolved through an injected `resolve(linkpath, sourcePath) → TFile | null`, backed by `metadataCache.getFirstLinkpathDest`.

*Alternative:* `markdown-it`. Rejected: mdast is a typed tree that maps more directly onto LegendKeeper's nested block model.

### D3. Element mapping

| Obsidian | LegendKeeper |
|---|---|
| `#`…`######` | `heading` level 1–6 |
| paragraph | `paragraph` (inline images split out into their own `image` blocks) |
| `**`, `*`, `~~`, `` ` `` | runs with `bold`, `italic`, `strike`, `code` (a `code` run carries no other mark) |
| `==x==` | run with `highlight` (a fixed yellow `#RRGGBB`) |
| `[t](http…)` | run with `link`. Only `http`, `https` and `mailto` are kept; anything else becomes plain text with a warning |
| `[[Note]]`, `[[Note\|alias]]`, `[[Note#H]]` | `mention { resourceId, text: alias? }`; `documentId` is omitted so the hash does not change when a note's document id becomes known; the heading anchor is dropped |
| `[[Note]]` whose target is unpublished, excluded or unresolved | plain text of the alias, or the link text; produces a warning |
| `![[img.png]]`, `![](img.png)` with a supported type | `image { url }` after upload; size hints ignored |
| `![[Note]]` (transclusion) | paragraph containing a mention of the target; produces a warning |
| other embeds (pdf, audio, svg, …) | omitted; produces a warning |
| lists, task lists | `bulletList` / `orderedList` / `taskList` with `listItem` / `taskItem` |
| GFM table | `table` → `tableRow` → `tableCell` (header row flagged) |
| fenced code | `code { language, text }` |
| `>` quote | `quote` |
| `---` | `rule` |
| `> [!secret]` | `secret` with converted children |
| `> [!note\|info\|tip\|success\|warning\|danger\|error\|…]` | `callout` with tone mapped (unknown types → `note`); the callout title becomes a bold first paragraph |
| math, footnotes, Mermaid, Dataview, HTML | `code` block, or literal text; produces a warning |

Block ids are left to LegendKeeper, which mints them; whole-page replace makes stable ids unnecessary (D7).

### D4. Resource fields from frontmatter and settings

- `name`: frontmatter `title` if it's a non-empty string, otherwise the file basename. Folders use the folder name, or the folder note's `title`.
- `tags`: `getAllTags(cache)` (frontmatter and inline), `#` stripped, deduplicated, case kept, nested `a/b` kept literal.
- `aliases`: frontmatter `aliases`.
- `iconGlyph` / `iconColor` / `iconShape`: `lk-icon`, `lk-color`, `lk-shape`. Invalid values are dropped with a warning.
- `isHidden`: the configurable hidden key (default `lk-hidden`) if it's a boolean, otherwise the "hidden by default" setting. Folders take it from their folder note, otherwise the default.
- `parentId`: the LegendKeeper id of the parent folder resource, or the mount point.

These fields, plus the page's block tree, are the only things the plugin owns on a resource. Other documents, sidebar properties, permissions, banner and lock state are never written.

### D5. Manifest stored in plugin data

```ts
interface Manifest {
  version: 1;
  projectId: string;
  mountId: string;
  assetFolderId?: string;
  entries: Record<string /*vault path*/, {
    kind: 'note' | 'folder';
    resourceId: string;
    documentId?: string;          // Main page doc; absent until first page write
    outputHash: string;           // SHA-256 of canonical JSON(resourceFields + blocks)
    docVersion?: string;          // version returned by the last page write
    publishedAt: number;
  }>;
  assets: Record<string /*sha256 of bytes*/, { assetId: string; url: string }>;
}
```

The manifest is saved in `data.json` alongside settings, so it syncs with the vault. The API key lives only in SecretStorage; settings store just the secret's *name*.

*Alternative:* writing the LegendKeeper id into each note's frontmatter. Rejected: it modifies user files and causes sync churn. The cost is the rename risk covered in Risks.

### D6. Change detection by hashing converted output

At review time each candidate is converted and the canonical JSON of `{resourceFields, blocks}` is hashed with SHA-256 (`crypto.subtle`). It is "Changed" when the hash differs from `entries[path].outputHash`. Because the hash covers converted output, the following trigger Changed exactly where the output differs:
- a newly published link target, where a plain-text link becomes a mention
- a changed setting, such as hidden-by-default
- a renamed parent

To keep the review fast, conversion results are cached in memory, keyed by `(path, mtime, size, settingsHash, linkTargetsHash)`. `linkTargetsHash` covers the resolved target ids of the note's outgoing links, taken from `metadataCache` without parsing the note.

The status bar shows a cheap estimate, debounced about 2s after `modify`, `rename`, `delete` and `create` events: a candidate counts as unpublished if it is missing from the manifest or its mtime is newer than `publishedAt`, and a manifest path with no file also counts.

### D7. Whole-page replace; conflicts via document version

The plugin owns the Main page document entirely, and every content publish is a `replaceBlocks` with `If-Match: docVersion`. During review, the plugin reads the current version of every selected Changed or Moved note's document. That read is throttled within the read budget; the cheapest version-bearing read is an open question (O1). A differing version marks the item ⚠ "Edited in LegendKeeper", unchecked by default. Checking it means overwrite, so the write is sent without `If-Match`.

At execution time, a `412` on a non-⚠ item is reported as a failure, never retried as an overwrite.

*Alternative:* a block-level diff with stable block ids, which would preserve LegendKeeper-side additions inside the page. Rejected for v1 as too complex; conflicts are surfaced instead.

### D8. Execution order and identity

1. **Plan.** Expand the selection with required parents: folder resources not yet in the manifest, shown as "(required)".
2. **Mint ids** for every new resource with `@paralleldrive/cuid2` at length 24, before any write. Mentions to notes created in the same run can then be built in one conversion pass.
3. **Create resources** top-down by depth, with `createMany` in chunks of 100 so `parentId` can reference earlier items. Each chunk sends an `Idempotency-Key` derived from its ids, so a retried chunk is replayed rather than duplicated. New siblings are submitted folders-first, then alphabetically by name, and LegendKeeper appends them after any existing siblings. The plugin never re-ranks afterwards. Resources are created without documents, so each gets one blank "Main" document; its id is read from the response and stored as `documentId`.
4. **Ensure the asset folder** exists (named after the vault). Upload images not already in `manifest.assets`, deduplicated by SHA-256, and send `contentHash` with the upload.
5. **Move** existing resources whose parent changed (`moveResource`, appended last under the new parent).
6. **Patch** resource fields that changed.
7. **Write pages** (`replaceBlocks`). Folders with no folder note get a single untitled `collection` filtered to the folder's children.
8. **Delete**, deepest first. A `409 HAS_CHILDREN` means the LegendKeeper resource has children the plugin does not manage. The executor pauses and asks the user whether to cascade or skip that item.

After each resource's operations succeed, its manifest entry is updated and saved. Saves are debounced but always flushed at the end of the run. A failure marks that item failed and the run continues; a dependent item, such as a child whose parent failed, is skipped with a reason. The run ends with a summary modal listing published, skipped and failed items with their error codes and request ids.

### D9. Network adapter and pacing

`lk/fetch.ts` adapts `requestUrl` (with `throw: false`) to the `fetch` signature: it builds a `Response` from `status`, `headers` and `arrayBuffer`. The SDK client is built with this `fetch` and with the SDK's own 429/5xx retries enabled.

A plugin-level token-bucket pacer sits in front of the client: about 110 writes/min and about 280 requests/min, leaving headroom below the limits. The pacer also reads the `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers to slow down early. Progress is shown in a persistent `Notice` ("Publishing 34/120…") and can be cancelled between operations.

### D10. Settings and setup gating

Settings:
- API key: a `SecretComponent` that stores the secret's name
- Project: read-only, discovered with `GET /projects`, since a key sees only its own project
- Mount point: picks an existing top-level resource or creates one named after the vault
- Exclusion frontmatter key: default `publish`
- Hidden frontmatter key: default `lk-hidden`
- Hidden by default: off
- Folder-note convention: `Folder/Folder.md`

Help text notes that the two hidden-page options require an admin key. The publish commands open a notice pointing to settings until the key, project and mount point are all set. Changing project or mount point after a publish warns the user and offers to reset the manifest.

A `403` while creating or patching a hidden resource is surfaced as "API key isn't an admin key; hidden pages can't be published". Those items stay pending and are **never** retried as visible.

### D11. Commands and UI

- **Publish changes…** (ribbon icon too): runs the full review.
- **Publish current note…**: opens the review filtered to the active note plus its required parents.
- **Reset publish state**: clears the manifest after a confirmation. It does not delete anything in LegendKeeper.

The review modal shows these groups, with select-all/none per group and a link on each row that opens the note:

| Group | Default |
|---|---|
| New | ✓ |
| Changed | ✓ |
| Moved/Renamed | ✓ |
| Deleted | ☐ |
| ⚠ Edited in LegendKeeper | ☐ |
| Required parents | locked ✓ while any child is selected |

Conversion warnings are shown per row, collapsed by default.

## Risks / Trade-offs

- **[Renames while the plugin isn't running, such as a sync from another device, show up as Deleted + New]** → When the review sees a missing manifest path and a new candidate with an identical body hash, it proposes them as a probable move. Deleted is unchecked by default anyway, so the worst case is a duplicate resource, never data loss.
- **[Large vaults make review conversion slow]** → mtime-keyed conversion cache; conversion runs in chunks that yield to the UI thread, with a progress indicator.
- **[Conflict-check reads cost about one read per Changed note]** → Reads are budgeted (300/min). For very large change sets the plugin skips the pre-check and relies on the `If-Match` failure at write time, with a note in the modal.
- **[Whole-page replace wipes LegendKeeper-side in-page edits on consented overwrite]** → Overwrite is opt-in per item, and unchecked by default.
- **[First publish of a big vault hits the 3,000 writes/hour limit]** → Batching (`createMany`), pacing, a resumable per-item commit, and a clear "rate limited, resuming in Ns" status.
- **[SecretStorage doesn't sync, and may collide across vaults on mobile (forum report)]** → Settings show "key not set on this device". Docs recommend a vault-specific secret name.
- **[Two devices publishing concurrently]** → `If-Match` catches page conflicts; the manifest is last-write-wins. This is documented as unsupported.
- **[Resource ids can't be reused after deletion]** → Ids are minted fresh per creation, and a "Reset publish state" never reuses old ids.
- **[A mention to a resource the reader can't see, such as a hidden page]** → This is LegendKeeper's normal permission behaviour; no mitigation is needed.

## Migration Plan

None. This is a new plugin. Releases follow the community-plugin flow: a GitHub release with `main.js`, `manifest.json` and `styles.css`, and `versions.json` mapping to `minAppVersion` 1.11.4.

## Open Questions

- **O1 (resolved).** `getDocument` has no `version`; `getDocumentBlocks` does, and it equals the version returned by the preceding write. The pre-check therefore uses `getBlocks` (one read per page). A stale `If-Match` answers `412 VERSION_MISMATCH` as designed.
- **O2 (partly resolved).** Creating a visible child under a hidden parent leaves the child's own `isHidden` false: the flag is per resource and is not inherited in the API. Whether the LegendKeeper app still hides the child from players is not visible through the API. Observed with an admin account: the child stays visible. Not yet checked from a non-admin member account, so treat hiding as per-page and do not rely on inheritance (documented in the README).
- **O3 (resolved).** A mention to a resource created in the same batch is accepted immediately.
- **O4.** What is the LegendKeeper web URL format for a resource, needed for a future "Open in LegendKeeper" command?
- **O5 (resolved).** The SDK client takes `{ apiKey, baseUrl?, fetch?, maxRetries?, timeoutMs? }`, where `fetch` is `(input: string, init: RequestInit) => Promise<Response>`.
- **O6.** The API has no dedicated "parent" collection filter. The folder page uses a generic `field` filter (`field: "parentId"`, `operator: "equals"`); the API accepts it. That it actually lists the children is not visible through the API; check by eye in 9.1, otherwise fall back to explicit `items` (≤256).
