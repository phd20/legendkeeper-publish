# settings Specification

## Purpose
TBD - created by archiving change add-legendkeeper-publish. Update Purpose after archive.
## Requirements
### Requirement: API key stored in SecretStorage
The plugin SHALL obtain the LegendKeeper API key only from Obsidian SecretStorage, referenced by a secret name stored in settings. The key value SHALL NOT be written to `data.json` or any vault file.

#### Scenario: Key selected via secret component
- **WHEN** the user selects or creates a secret in the API key setting
- **THEN** settings persist only the secret's name, and the plugin reads the value via `app.secretStorage.getSecret(name)` when making requests

#### Scenario: Key missing on this device
- **WHEN** the configured secret name has no value on the current device
- **THEN** the settings tab shows "API key not set on this device" and publish commands are blocked with a notice pointing to settings

### Requirement: Project discovery
The plugin SHALL discover the key's project via the LegendKeeper projects endpoint and display its name read-only; the user SHALL NOT choose a project manually.

#### Scenario: Valid key
- **WHEN** a key is configured and the projects request succeeds
- **THEN** the settings tab displays the project name and the plugin stores the project id

#### Scenario: Unpaid plan or invalid key
- **WHEN** the projects request answers `401` or `402`
- **THEN** the settings tab shows the error meaning (invalid/revoked key, or paid plan required) and the project remains unset

### Requirement: Mount point selection
The plugin SHALL require a mount-point resource under which all published resources are created. The user SHALL be able to pick an existing top-level resource of the project or create a new top-level resource named after the vault.

#### Scenario: Create mount point
- **WHEN** the user chooses "Create «vault name»"
- **THEN** a top-level resource with the vault's name is created and its id stored as the mount point

#### Scenario: Pick existing mount point
- **WHEN** the user picks an existing top-level resource
- **THEN** its id is stored as the mount point and no other resource is modified

### Requirement: Publishing gated on complete setup
The plugin SHALL block all publish operations until the API key, project, and mount point are set.

#### Scenario: Incomplete setup
- **WHEN** the user runs a publish command with any of key, project, or mount point unset
- **THEN** no review is computed and a notice directs the user to the plugin settings

### Requirement: Changing target after publishing
The plugin SHALL warn when the project or mount point changes while the manifest holds published entries, and SHALL offer to reset the manifest.

#### Scenario: Mount point changed
- **WHEN** the user changes the mount point and the manifest is non-empty
- **THEN** a confirmation explains that previously published resources will no longer be tracked and offers to reset the manifest; declining reverts the change

### Requirement: Configurable frontmatter keys
The plugin SHALL provide settings for the exclusion frontmatter key (default `publish`) and the hidden frontmatter key (default `lk-hidden`).

#### Scenario: Custom exclusion key
- **WHEN** the exclusion key is set to `lk-publish`
- **THEN** notes with `lk-publish: false` are excluded and `publish: false` has no effect

### Requirement: Hidden by default
The plugin SHALL provide a "Publish new pages hidden by default" setting (default off), and SHALL state in the setting description that hidden publishing requires an admin API key.

#### Scenario: Default hidden enabled
- **WHEN** the setting is on and a note has no hidden key in its frontmatter
- **THEN** the note's resource is published with `isHidden: true`

### Requirement: Folder note convention
The plugin SHALL treat `Folder/Folder.md` (a note with the same basename as its parent folder) as the folder note supplying that folder resource's page and fields.

#### Scenario: Folder note present
- **WHEN** `Lore/Lore.md` exists
- **THEN** the `Lore` folder resource's page and fields come from `Lore/Lore.md`, and `Lore/Lore.md` is not published as a separate resource

### Requirement: Minimum Obsidian version
The plugin manifest SHALL declare `minAppVersion` 1.11.4 and `isDesktopOnly: false`.

#### Scenario: Manifest values
- **WHEN** the plugin is built
- **THEN** `manifest.json` contains `"minAppVersion": "1.11.4"` and `"isDesktopOnly": false`

