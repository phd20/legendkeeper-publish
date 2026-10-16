# publish-review Specification

## Purpose
TBD - created by archiving change add-legendkeeper-publish. Update Purpose after archive.
## Requirements
### Requirement: Publish commands
The plugin SHALL register the commands "Publish changes…", "Publish current note…", and "Reset publish state", and a ribbon icon that runs "Publish changes…".

#### Scenario: Full review
- **WHEN** the user runs "Publish changes…" or clicks the ribbon icon
- **THEN** the review modal opens listing all classified changes in the vault

#### Scenario: Current note review
- **WHEN** the user runs "Publish current note…" with a note active
- **THEN** the review modal opens listing only that note and any required parents

#### Scenario: Reset publish state
- **WHEN** the user runs "Reset publish state" and confirms
- **THEN** the manifest is cleared and nothing in LegendKeeper is modified

### Requirement: Change classification
The review SHALL classify each item into exactly one group: New, Changed, Moved/Renamed, Deleted, Edited in LegendKeeper, or Required parent. Unchanged items SHALL NOT be listed.

#### Scenario: Moved note
- **WHEN** a published note's parent folder changed
- **THEN** it appears under Moved/Renamed

### Requirement: Default selections
New, Changed, and Moved/Renamed items SHALL be checked by default; Deleted and Edited in LegendKeeper items SHALL be unchecked by default. Each group SHALL offer select-all and select-none.

#### Scenario: Opening the review
- **WHEN** the review opens with one New, one Deleted, and one Edited-in-LegendKeeper item
- **THEN** only the New item is checked

### Requirement: Required parents
When a selected item needs a folder resource that does not yet exist, the review SHALL include that folder as a Required parent that cannot be unchecked while any of its descendants is selected.

#### Scenario: New note in new folder
- **WHEN** the user selects `Factions/Guild.md` and `Factions/` has no resource
- **THEN** `Factions` is listed as Required parent, checked and locked

#### Scenario: Unselecting the child
- **WHEN** the user unchecks every selected descendant of `Factions`
- **THEN** the `Factions` Required parent becomes unchecked

### Requirement: LegendKeeper edit detection
Before showing the review, the plugin SHALL read the current page document version of each Changed or Moved item and SHALL classify the item as Edited in LegendKeeper when it differs from the manifest's stored version. Checking such an item SHALL mean overwriting the LegendKeeper edits.

#### Scenario: Page edited in LegendKeeper
- **WHEN** a published note was edited locally and its page was also edited in LegendKeeper
- **THEN** it appears under Edited in LegendKeeper, unchecked, with an explanation that publishing overwrites the LegendKeeper edits

#### Scenario: Resource fields edited only in LegendKeeper
- **WHEN** only the resource name or tags were changed in LegendKeeper
- **THEN** the item is not flagged, and the next publish of that note overwrites those fields

### Requirement: Row details
Each row SHALL show the vault path, the target resource name, and a control to open the note; rows with conversion warnings SHALL show a collapsible list of warnings.

#### Scenario: Warning shown
- **WHEN** a note contains an unresolved wikilink
- **THEN** its row shows a warning indicator that expands to "Unresolved link: Secret Plans"

### Requirement: Probable moves
When a Deleted path and a New candidate have identical converted block trees, the review SHALL present them as a single Moved/Renamed item that reuses the existing resource.

#### Scenario: Renamed outside Obsidian
- **WHEN** `Keep.md` was renamed to `The Keep.md` via file sync while the plugin was not running
- **THEN** the review shows one Moved/Renamed item instead of one New and one Deleted

