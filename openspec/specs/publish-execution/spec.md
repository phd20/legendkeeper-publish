# publish-execution Specification

## Purpose
TBD - created by archiving change add-legendkeeper-publish. Update Purpose after archive.
## Requirements
### Requirement: Client-chosen resource ids
The executor SHALL mint a new 24-character cuid2 id for every resource to be created before issuing any write, and SHALL create the resource with that id.

#### Scenario: New note
- **WHEN** a New note is published
- **THEN** the created LegendKeeper resource has the id minted for it and that id is recorded in the manifest

### Requirement: Operation ordering
The executor SHALL perform operations in this order: create resources top-down by depth, upload images, move resources, patch resource fields, write pages, delete resources deepest-first.

#### Scenario: New folder with new child
- **WHEN** a New folder and a New note inside it are published
- **THEN** the folder resource is created before the note resource, and the note's `parentId` is the folder's id

### Requirement: Batched creation with idempotency
Resource creation SHALL use batch creation in chunks of at most 100 and SHALL send an idempotency key derived from the chunk's ids.

#### Scenario: Retried chunk
- **WHEN** a creation chunk is retried after a network error
- **THEN** no duplicate resources are created

### Requirement: Sibling order on creation
New siblings created in one run SHALL be submitted folders first, then alphabetically by name, and are appended after existing siblings. The plugin SHALL NOT re-rank existing resources.

#### Scenario: Two new notes
- **WHEN** `Zeta.md` and `Alpha.md` are created under the same folder in one run
- **THEN** Alpha is placed before Zeta in LegendKeeper

### Requirement: Image upload and deduplication
The executor SHALL upload each referenced image whose SHA-256 is not in the manifest through the upload flow (create upload, PUT bytes to the signed URL with the given headers, create image asset in the vault's asset folder) and record the hash → asset mapping. Images already in the manifest SHALL NOT be re-uploaded.

#### Scenario: Same image in two notes
- **WHEN** two notes embed the same `crest.png`
- **THEN** it is uploaded once and both image blocks reference the same asset URL

#### Scenario: Asset folder
- **WHEN** the first image is uploaded
- **THEN** an asset folder named after the vault is created (if missing) and the asset is placed in it

### Requirement: Page writes with version check
The executor SHALL replace a resource's Main page with the converted block tree, sending the stored document version as `If-Match` unless the user opted to overwrite an Edited-in-LegendKeeper item, and SHALL store the returned version.

#### Scenario: Unexpected remote edit
- **WHEN** a page write answers `412 VERSION_MISMATCH` for an item not marked as overwrite
- **THEN** the item fails with "edited in LegendKeeper since review", is not retried as an overwrite, and remains pending

### Requirement: Moves and renames
The executor SHALL move an existing resource whose parent changed to its new parent, and patch its name when the name changed.

#### Scenario: Note moved between folders
- **WHEN** `Places/Keep.md` is moved to `Ruins/Keep.md`
- **THEN** the same resource is moved under the `Ruins` resource and no new resource is created

### Requirement: Deletes to trash
The executor SHALL delete Deleted items by soft-deleting the resource (to the LegendKeeper trash), deepest first. On `409 HAS_CHILDREN` it SHALL ask the user whether to cascade or skip that item.

#### Scenario: Deleted folder with foreign children
- **WHEN** a deleted folder's LegendKeeper resource has children not managed by the plugin
- **THEN** the user is asked to cascade or skip, and the chosen action is applied to that item only

### Requirement: Hidden resources never fall back to visible
When creating or patching a resource with `isHidden: true` answers `403`, the executor SHALL fail that item with "API key isn't an admin key; hidden pages can't be published" and SHALL NOT retry it without `isHidden`.

#### Scenario: Non-admin key
- **WHEN** hidden-by-default is on and the key is not an admin key
- **THEN** affected items fail with the admin message, no resource is created visible, and the items remain pending

### Requirement: Rate-limit pacing
The executor SHALL pace requests below the API's per-key limits (writes per minute and requests per minute), honor `Retry-After` on `429`, and show progress as a count of completed items.

#### Scenario: Rate limited
- **WHEN** a request answers `429` with `Retry-After: 20`
- **THEN** the executor waits 20 seconds, shows "Rate limited, resuming in 20s", and continues

### Requirement: Per-item commit and failure handling
The executor SHALL update and persist the manifest entry for each item as soon as all of its operations succeed, continue past failed items, skip items whose dependency (e.g. parent) failed, and end with a summary listing published, skipped, and failed items with error codes and request ids.

#### Scenario: One failure among many
- **WHEN** one of ten selected notes fails validation
- **THEN** the other nine are published and recorded, the failed one is listed in the summary with its error code and request id, and it appears again in the next review

#### Scenario: Parent failure
- **WHEN** a New folder's creation fails
- **THEN** its New children are skipped with reason "parent not published"

### Requirement: Cancellation
The user SHALL be able to cancel a running publish; the executor SHALL stop before the next operation and leave the manifest consistent with completed items.

#### Scenario: Cancel mid-run
- **WHEN** the user cancels after 30 of 100 items
- **THEN** no further requests are sent, the 30 completed items are in the manifest, and the remaining 70 appear in the next review

### Requirement: Network via requestUrl
All LegendKeeper API calls and signed-URL uploads SHALL go through Obsidian's `requestUrl` (via a `fetch` adapter for the SDK), so the plugin works on desktop and mobile without CORS failures.

#### Scenario: Mobile publish
- **WHEN** a publish runs on Obsidian mobile
- **THEN** API calls and uploads succeed using `requestUrl`

