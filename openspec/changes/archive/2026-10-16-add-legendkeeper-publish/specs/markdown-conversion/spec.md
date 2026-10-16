## ADDED Requirements

### Requirement: Pure conversion function
The converter SHALL be a pure function from (note markdown, frontmatter, tags, settings, link resolver, published-id lookup) to (resource fields, page block tree, warnings), with no dependency on the Obsidian runtime or network.

#### Scenario: Deterministic output
- **WHEN** the same inputs are converted twice
- **THEN** both outputs are deeply equal and hash identically

### Requirement: Block structure mapping
The converter SHALL map headings, paragraphs, bullet/ordered/task lists, GFM tables, fenced code, block quotes, and horizontal rules to the corresponding LegendKeeper block kinds, preserving nesting.

#### Scenario: Nested list
- **WHEN** a note contains a bullet list with a nested ordered list
- **THEN** the output contains a `bulletList` whose `listItem` children contain an `orderedList`

#### Scenario: Task list
- **WHEN** a note contains `- [x] Done` and `- [ ] Todo`
- **THEN** the output contains a `taskList` with two `taskItem` blocks with checked states true and false

#### Scenario: Table with header
- **WHEN** a note contains a GFM table
- **THEN** the output contains a `table` whose first row's cells are flagged as header cells

#### Scenario: Code block
- **WHEN** a note contains a fenced block tagged `ts`
- **THEN** the output contains a `code` block with `language: "ts"` and the verbatim text

### Requirement: Inline marks
The converter SHALL map bold, italic, strikethrough, inline code, and `==highlight==` to run marks, and external links with `http`, `https`, or `mailto` schemes to `link` marks. A `code` run SHALL carry no other mark.

#### Scenario: Highlight
- **WHEN** a paragraph contains `==important==`
- **THEN** the run for "important" carries a `highlight` color

#### Scenario: Unsupported link scheme
- **WHEN** a paragraph contains `[x](obsidian://open?vault=a)`
- **THEN** "x" is emitted as plain text and a warning is recorded

### Requirement: Wikilinks to mentions
The converter SHALL convert a wikilink whose target resolves to a published-or-being-published candidate into a `mention` run with the target's resource id and Main document id. An alias SHALL become the mention text; heading and block anchors SHALL be dropped.

#### Scenario: Aliased link
- **WHEN** a note contains `[[Aldric the Bold|the king]]` and Aldric is published
- **THEN** the output contains a mention run for Aldric's resource id with text "the king"

#### Scenario: Link to unpublished note
- **WHEN** a note links `[[Secret Plans]]` and that note is excluded or not selected in this run
- **THEN** the output contains the plain text "Secret Plans" and a warning naming the unresolved link

#### Scenario: Link to note created in the same run
- **WHEN** notes A and B are both New in this run and A links `[[B]]`
- **THEN** A's mention uses B's pre-minted resource id

### Requirement: Callouts
The converter SHALL convert Obsidian callouts to `callout` blocks, mapping the callout type to the nearest tone (`info`, `note`, `success`, `warning`, `error`) and defaulting unknown types to `note`. A callout title SHALL become a bold first paragraph inside the callout.

#### Scenario: Warning callout
- **WHEN** a note contains `> [!warning] Beware` followed by body lines
- **THEN** the output contains a `callout` with tone `warning` whose first child is a paragraph with bold "Beware"

### Requirement: Secrets and comments
The converter SHALL convert `> [!secret]` callouts to `secret` blocks with converted children, and SHALL strip `%%…%%` comments (inline and multi-line) from the output entirely.

#### Scenario: Secret callout
- **WHEN** a note contains `> [!secret]` followed by `> The duke is a vampire.`
- **THEN** the output contains a `secret` block containing that paragraph

#### Scenario: Comment stripped
- **WHEN** a note contains `Hello %%todo fix%% world`
- **THEN** the output paragraph text is `Hello  world` with no trace of the comment

### Requirement: Image embeds
The converter SHALL convert embeds of JPEG, PNG, GIF, and WebP files (wikilink or markdown syntax) into `image` blocks referencing the uploaded asset URL, splitting inline images out of paragraphs into their own blocks. Size hints SHALL be ignored. Other embedded file types SHALL be omitted with a warning.

#### Scenario: Wikilink image
- **WHEN** a note contains `![[map.png|400]]`
- **THEN** the output contains an `image` block for `map.png`'s asset URL and the width hint is ignored

#### Scenario: Unsupported attachment
- **WHEN** a note embeds `![[handout.pdf]]`
- **THEN** nothing is emitted for it and a warning is recorded

### Requirement: Degraded syntax
Note transclusions SHALL become a paragraph containing a mention of the target (or plain text if unpublished); math, footnotes, Mermaid, Dataview, and raw HTML SHALL be emitted as code blocks or literal text. Each SHALL record a warning.

#### Scenario: Transclusion
- **WHEN** a note contains `![[Pantheon]]` and Pantheon is published
- **THEN** the output contains a paragraph with a mention of Pantheon and a warning "transclusion not supported"

### Requirement: Resource field mapping
The converter SHALL derive resource fields as: name from frontmatter `title` else the basename; tags from all frontmatter and inline tags with `#` removed and duplicates dropped; aliases from frontmatter `aliases`; icon glyph, color, and shape from `lk-icon`, `lk-color`, `lk-shape`; `isHidden` from the configured hidden key if boolean, else the hidden-by-default setting; parent from the parent folder resource or the mount point.

#### Scenario: Title override
- **WHEN** `aldric.md` has frontmatter `title: Aldric the Bold`
- **THEN** the resource name is "Aldric the Bold"

#### Scenario: Nested tag
- **WHEN** a note has tag `#place/city`
- **THEN** the resource tags include the literal string `place/city`

#### Scenario: Hidden override
- **WHEN** hidden-by-default is on and a note has `lk-hidden: false`
- **THEN** the resource is published with `isHidden: false`

#### Scenario: Invalid color
- **WHEN** a note has `lk-color: red`
- **THEN** no icon color is sent and a warning is recorded

### Requirement: Folder page without folder note
A folder resource without a folder note (or with an excluded one) SHALL get a page containing a single untitled collection block listing its child resources.

#### Scenario: Auto collection
- **WHEN** the `Places` folder has no `Places/Places.md`
- **THEN** its page contains one `collection` block filtered to children of the `Places` resource with its title hidden
