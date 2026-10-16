## ADDED Requirements

### Requirement: Publish candidates
Every markdown file in the vault SHALL be a publish candidate unless its frontmatter sets the configured exclusion key to `false`. Non-markdown files SHALL only be published as image assets referenced by candidates.

#### Scenario: Default inclusion
- **WHEN** a note has no exclusion key in frontmatter
- **THEN** it is a candidate

#### Scenario: Excluded note
- **WHEN** a note's frontmatter has the exclusion key set to `false`
- **THEN** it is not a candidate and links to it render as plain text in other notes

#### Scenario: Previously published note becomes excluded
- **WHEN** a note in the manifest gains the exclusion key set to `false`
- **THEN** it is classified as Deleted in the next review

### Requirement: Folder resources
A folder SHALL have a resource only if at least one descendant note is a candidate. Folders containing only attachments or excluded notes SHALL NOT be published.

#### Scenario: Folder with only excluded notes
- **WHEN** every note under `Drafts/` is excluded
- **THEN** no resource is planned for `Drafts/`

#### Scenario: Excluded folder note
- **WHEN** `Lore/Lore.md` is excluded but `Lore/Gods.md` is a candidate
- **THEN** the `Lore` folder resource is published with the auto-generated children collection as its page

### Requirement: Publish manifest
The plugin SHALL persist a manifest in plugin data mapping each published vault path to its LegendKeeper resource id, page document id, output hash, last document version, and publish time, plus a map of image content hashes to asset ids and URLs.

#### Scenario: Entry written after publish
- **WHEN** a note is successfully published
- **THEN** the manifest entry for its path records the resource id, document id, output hash, returned document version, and publish time, and plugin data is saved

### Requirement: Output-hash change detection
A published candidate SHALL be classified Changed if and only if the SHA-256 of the canonical JSON of its converted resource fields and block tree differs from the manifest's stored output hash.

#### Scenario: Whitespace-only edit
- **WHEN** a published note is edited such that its converted output is identical
- **THEN** it is not classified Changed

#### Scenario: Link target becomes published
- **WHEN** note A links `[[B]]`, A was published while B was unpublished, and B is then published
- **THEN** A is classified Changed in the next review because its link now converts to a mention

#### Scenario: Setting change
- **WHEN** "hidden by default" is toggled
- **THEN** every published note whose hidden state is not set by frontmatter is classified Changed

### Requirement: Conversion cache
The plugin SHALL cache conversion results keyed by path, mtime, size, a settings hash, and a hash of the note's resolved link targets, and SHALL reuse cached results when all keys match.

#### Scenario: Unchanged note on second review
- **WHEN** the review is opened twice without vault or settings changes
- **THEN** the second review performs no re-conversion of unchanged notes

### Requirement: Rename and move tracking
The plugin SHALL listen for vault rename events and re-key manifest entries (including all entries under a renamed folder) to the new path, preserving their LegendKeeper ids.

#### Scenario: Note renamed in Obsidian
- **WHEN** `Places/Keep.md` is renamed to `Places/The Keep.md` while the plugin is loaded
- **THEN** the manifest entry moves to the new path with the same resource id, and the note is classified Changed (name differs) rather than New + Deleted

#### Scenario: Rename while plugin not loaded
- **WHEN** a manifest path no longer exists and a new candidate has an identical converted block tree
- **THEN** the review proposes them as a probable Moved item rather than New + Deleted

### Requirement: Deletion detection
A manifest entry whose path no longer exists as a candidate SHALL be classified Deleted.

#### Scenario: Note deleted
- **WHEN** a published note is deleted from the vault
- **THEN** it appears as Deleted in the next review

### Requirement: Unpublished-changes status bar
The plugin SHALL show a status-bar item with an estimated count of unpublished changes, recomputed (debounced) after vault create, modify, rename, and delete events, and clicking it SHALL open the review.

#### Scenario: Edit increments count
- **WHEN** a published note is modified
- **THEN** within a few seconds the status bar count includes it (e.g. `LK: 1 unpublished`)

#### Scenario: Click opens review
- **WHEN** the user clicks the status-bar item
- **THEN** the publish review opens
