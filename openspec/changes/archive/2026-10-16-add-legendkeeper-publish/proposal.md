## Why

Worldbuilders who write in Obsidian have no way to push their notes into LegendKeeper other than copy-paste, and re-syncing edits by hand does not scale past a handful of pages. LegendKeeper now exposes a v3 REST API (block-tree documents, client-chosen stable ids, image uploads, versioned writes), which makes an Obsidian-Publish-style workflow possible: write in the vault, review what changed, publish to LegendKeeper.

## What Changes

- New Obsidian community plugin **LegendKeeper Publish** (id `legendkeeper-publish`, `minAppVersion` 1.11.4, desktop and mobile).
- One-way push: the vault is the source of truth; LegendKeeper-side edits to a published page are detected and flagged, never merged back.
- Every markdown file is a publish candidate unless its frontmatter sets the configurable exclusion key (default `publish`) to `false`.
- Vault folders map to LegendKeeper resources under a single configurable mount-point resource; folder notes (`Folder/Folder.md`) supply the folder's page, otherwise an auto-generated collection of children is written.
- A markdown → LegendKeeper block converter: headings, paragraphs, inline marks, links, lists, task lists, tables, code, quotes, rules, callouts, image embeds, wikilinks → mentions, `> [!secret]` → secret blocks, `%%comments%%` stripped. Unsupported syntax degrades to text/code with a warning.
- Frontmatter mapping: tags (frontmatter + inline) → tags, `aliases` → aliases, `title` → resource name, `lk-icon`/`lk-color`/`lk-shape` → pin icon, a configurable hidden key (default `lk-hidden`) → `isHidden`, plus a "publish new pages hidden by default" setting.
- Change tracking via a manifest of path → LegendKeeper id and a hash of the converted output; a status-bar count of unpublished changes.
- A review modal (command + ribbon) grouping New / Changed / Moved / Deleted / Edited-in-LegendKeeper items with sensible default selections, then a paced, per-item-committed publish run with a summary.
- API key stored in Obsidian SecretStorage, never in `data.json`.

## Capabilities

### New Capabilities
- `settings`: API key via SecretStorage, project discovery, mount-point selection, exclusion key, hidden key, hidden-by-default, folder-note convention, and the gating of publishing on complete setup.
- `vault-tracking`: candidate selection, the publish manifest, output hashing with an mtime cache, rename/move/delete detection, and the status-bar indicator.
- `markdown-conversion`: conversion of a note (body + frontmatter) into a LegendKeeper resource payload and page block tree, including link resolution, secrets, callouts, images, and degradation warnings.
- `publish-review`: the review modal, change classification, default selections, required-parent handling, LegendKeeper-edit conflict detection, and commands.
- `publish-execution`: ordering, resource creation with client-chosen ids, image upload and dedup, page writes with `If-Match`, moves, deletes, rate-limit pacing, per-item commit, and failure reporting.

### Modified Capabilities
<!-- none: this is a new project -->

## Impact

- New TypeScript project based on `obsidian-sample-plugin` (esbuild, `obsidian` API typings).
- New dependency `@legendkeeper/sdk` (types, block builders, client) driven through a custom `fetch` adapter over Obsidian `requestUrl`; `vitest` for unit tests; a markdown parser for the converter.
- External system: writes to one LegendKeeper project (paid plan required by the API). Admin-role key required for hidden pages.
- Plugin data (`data.json`) holds the manifest and syncs with the vault; secrets do not sync and must be entered per device.
