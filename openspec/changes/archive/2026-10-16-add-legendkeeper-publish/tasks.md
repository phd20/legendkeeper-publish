## 1. Project setup

- [x] 1.1 Scaffold from `obsidian-sample-plugin` (esbuild, TS strict); set `manifest.json` id `legendkeeper-publish`, name "LegendKeeper Publish", `minAppVersion` 1.11.4, `isDesktopOnly` false; add `versions.json`
- [x] 1.2 Add dependencies: `@legendkeeper/sdk`, `@paralleldrive/cuid2`, `mdast-util-from-markdown` + GFM extensions; dev: `vitest`
- [x] 1.3 Create module skeleton `src/{settings,lk,convert,tracking,review,publish}` and a `tests/fixtures/vault` directory
- [x] 1.4 Configure vitest and an `npm test` script; add lint config per Obsidian plugin guidelines

## 2. Spikes against a LegendKeeper test project

- [x] 2.1 Create a dedicated LegendKeeper test project and admin API key (user task)
- [x] 2.2 Confirm SDK client options for custom `fetch` and retries (O5): `new LegendKeeper({ apiKey, baseUrl?, fetch?: (input: string, init: RequestInit) => Promise<Response>, maxRetries?, timeoutMs? })`
- [x] 2.3 Determine the cheapest read returning a page document's `version` (O1): `documents.getBlocks`
- [x] 2.4 Verify mentions to resources created earlier in the same run validate immediately (O3)
- [x] 2.5 Check whether hiding a parent hides its children; record result in design.md (O2): `isHidden` is not inherited via the API; confirm in the app during 9.1

## 3. LegendKeeper client layer (`src/lk`)

- [x] 3.1 Implement `requestUrl` → `fetch` adapter (`throw: false`, headers, arrayBuffer body → `Response`)
- [x] 3.2 Build SDK client factory reading the key from SecretStorage per request batch (`createLkApi`; the secret is read in main.ts wiring and passed in)
- [x] 3.3 Implement token-bucket pacer (≈110 writes/min, ≈280 req/min) using `X-RateLimit-*` and `Retry-After`, with cancellation support
- [x] 3.4 Implement cuid2 24-char id minting helper with format validation
- [x] 3.5 Implement signed-URL image upload helper (PUT bytes with returned headers via `requestUrl`) (the SDK's `assets.uploadImage` does the 3-step flow and sends the signed-URL PUT through our `requestUrl` fetch)

## 4. Settings (`src/settings`)

- [x] 4.1 Define settings type and defaults
- [x] 4.2 Build SettingTab: SecretComponent for the key, "not set on this device" state, admin-key help text on hidden options
- [x] 4.3 Project discovery via `GET /projects` with 401/402 error display
- [x] 4.4 Mount-point picker (existing top-level resources) and "Create «vault name»" action
- [x] 4.5 Warn + offer manifest reset when project or mount point changes with a non-empty manifest
- [x] 4.6 Setup-gating helper used by all publish commands

## 5. Markdown conversion (`src/convert`, pure)

- [x] 5.1 Pre-pass stripping `%%comments%%` (inline and multi-line)
- [x] 5.2 Micromark/mdast extensions for wikilinks, embeds (with `#`, `^`, `|`), and `==highlight==`
- [x] 5.3 Block mapping: headings, paragraphs, lists, task lists, tables, code, quotes, rules
- [x] 5.4 Inline mapping: marks, highlight, external links with scheme filter, line breaks; enforce `code` run constraints
- [x] 5.5 Wikilink → mention via injected resolver + published-id lookup; plain-text fallback with warning
- [x] 5.6 Callouts → `callout` with tone mapping and bold title; `[!secret]` → `secret`
- [x] 5.7 Image embeds → `image` blocks (split from paragraphs) via injected asset-URL lookup; unsupported attachments omitted with warning
- [x] 5.8 Degradations with warnings: transclusion → mention paragraph; math/footnotes/Mermaid/Dataview/HTML → code or literal
- [x] 5.9 Resource field mapping: title/basename, tags (strip `#`, dedupe), aliases, `lk-icon`/`lk-color`/`lk-shape` validation, hidden key vs default, parentId
- [x] 5.10 Folder page generation: untitled children collection when no (or excluded) folder note
- [x] 5.11 Canonical JSON serialization + SHA-256 output hash
- [x] 5.12 Unit tests for every conversion scenario in `specs/markdown-conversion` against fixture notes

## 6. Vault tracking (`src/tracking`)

- [x] 6.1 Manifest types, load/save in plugin data, debounced save with explicit flush
- [x] 6.2 Candidate scan: all `.md` minus exclusion key; folder-note detection; folder resources only when a descendant is a candidate
- [x] 6.3 Conversion cache keyed by path, mtime, size, settings hash, link-targets hash
- [x] 6.4 Pure planner: (candidates + hashes, manifest) → New / Changed / Moved / Deleted / Required parents, including probable-move pairing
- [x] 6.5 Vault rename listener re-keying manifest entries
- [x] 6.6 Status-bar estimate
- [x] 6.7 Unit tests for planner and probable-move scenarios in `specs/vault-tracking`

## 7. Review (`src/review`)

- [x] 7.1 Review pipeline: scan → convert (chunked, yielding, with progress) → plan → version pre-check of Changed/Moved items within read budget
- [x] 7.2 ReviewModal with groups, default selections, select-all/none, open-note links, collapsible warnings
- [x] 7.3 Required-parent locking/unlocking logic tied to descendant selection
- [x] 7.4 Edited-in-LegendKeeper group with overwrite explanation
- [x] 7.5 Register commands "Publish changes…", "Publish current note…" (filtered), "Reset publish state" (confirm), and ribbon icon

## 8. Execution (`src/publish`)

- [x] 8.1 Build ordered operation plan from the selection (creates by depth, uploads, moves, patches, page writes, deletes deepest-first)
- [x] 8.2 Batched `createMany` (≤100) with idempotency keys and sibling ordering (folders first, alphabetical)
- [x] 8.3 Asset folder ensure + image upload with SHA-256 dedup and `contentHash`
- [x] 8.4 Moves, field patches, and page `replaceBlocks` with `If-Match` / overwrite handling; store returned versions
- [x] 8.5 Deletes with `HAS_CHILDREN` cascade-or-skip prompt
- [x] 8.6 Error handling: per-item commit, dependency skips, `412` and hidden-`403` messages (no visible fallback)
- [x] 8.7 Progress notice with cancel; final summary modal with codes and request ids
- [x] 8.8 Executor tests with a mocked client covering ordering, failure, and cancellation scenarios in `specs/publish-execution`

## 9. Verification and release

- [ ] 9.1 End-to-end manual run against the test project: first publish of fixture vault, edit/rename/move/delete cycle, LegendKeeper-side edit conflict, hidden pages with admin and non-admin keys
- [ ] 9.2 Mobile smoke test (publish one note with an image)
- [x] 9.3 README: setup, frontmatter keys, secrets syntax, limitations, rate limits, per-device key note
- [x] 9.4 GitHub release workflow producing `main.js`, `manifest.json`, `styles.css`
