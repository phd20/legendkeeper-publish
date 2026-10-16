# LegendKeeper Publish

An Obsidian plugin that publishes your notes to a [LegendKeeper](https://www.legendkeeper.com) project, the way Obsidian Publish does for the web: it tracks what changed, a command opens a review of the changes, and you choose what to send.

Publishing is **one-way**. Your vault is the source of truth; LegendKeeper edits are never pulled back, and a page edited in LegendKeeper since your last publish is flagged so you can choose whether to overwrite it.

## Setup

1. In LegendKeeper, open your project's settings, go to **Developers**, and create an API key. API keys need a paid LegendKeeper plan (a trial does not count). Use an **admin** key if you want to publish hidden pages.
2. In Obsidian, open **Settings → LegendKeeper Publish** and pick the key. It is stored in Obsidian's secret storage, never in the vault. Secrets do not sync between devices, so enter the key once per device.
3. Choose **Connect** to confirm the project, then choose a **mount point**: an existing top-level page, or create one named after your vault. Everything is published beneath it, and the plugin never touches pages outside it.

Requires Obsidian 1.11.4 or later. Works on desktop and mobile.

## Publishing

| Command | What it does |
|---|---|
| **Publish changes…** (also the ribbon icon and the status bar item) | Opens the review for the whole vault |
| **Publish current note…** | Reviews only the open note and any new folders it needs |
| **Reset publish state** | Forgets what was published, so the next review lists everything as new. Nothing in LegendKeeper changes. |

The status bar shows an estimate such as `LK: 7 unpublished`. The review computes the exact list.

### The review

| Group | Checked by default |
|---|---|
| New | yes |
| Changed | yes |
| Moved / renamed | yes |
| Required parents (new folders) | yes, and locked while a note beneath them is selected |
| Edited in LegendKeeper | no. Checking it overwrites the LegendKeeper edits. |
| Deleted | no. Moves the page to the LegendKeeper trash, where it can be restored. |

A note counts as **Changed** when what would be published changes, not when the file's bytes change. Whitespace-only edits are ignored, and a note that links to a page you have just published is flagged because its link becomes a real mention.

## How notes map

- **Folders** become pages. A folder note (`Lore/Lore.md`) supplies the folder's page; otherwise the folder page lists its children. A folder only exists if something beneath it is published.
- **Notes** become pages named by frontmatter `title`, or the file name.
- **Wikilinks** to published notes become LegendKeeper mentions. Links to excluded or unpublished notes become plain text, with a warning in the review.
- **Images** (PNG, JPEG, GIF, WebP) are uploaded once, deduplicated by content, into an asset folder named after your vault.

### Frontmatter

| Property | Effect |
|---|---|
| `publish: false` | Excludes the note. The property name is a setting. |
| `title` | Page name |
| `tags` and inline `#tags` | Tags, with `#` removed. `place/city` is kept as written. |
| `aliases` | Aliases |
| `lk-icon`, `lk-color`, `lk-shape` | Icon glyph (a Font Awesome name), `#RRGGBB` color, pin shape |
| `lk-hidden: true` | Publishes the page hidden from players. The property name is a setting. Needs an admin key. |

Hiding applies to each page on its own. Don't rely on a hidden parent folder to hide the pages inside it: set the hidden property on every page that must stay GM-only, or turn on **Publish pages hidden by default**. (Whether LegendKeeper hides children of a hidden page from players has not been confirmed.)

The **Publish pages hidden by default** setting hides every page unless the note sets the hidden property to `false`. If your key is not an admin key, hidden pages fail with a clear message and are never published visible.

### Markdown

Supported: headings, paragraphs, bold, italic, strikethrough, `==highlight==`, inline code, links, lists, task lists, tables, code blocks, quotes, rules, callouts, and image embeds.

- `> [!secret]` callouts become secret blocks (hidden from players).
- `%%comments%%` are removed and never published.
- Other callouts map to the closest LegendKeeper tone.

Degraded with a warning: note transclusion (`![[Note]]` becomes a mention), footnotes, math, Mermaid, Dataview, and raw HTML. Unsupported embeds (PDF, audio, SVG) are skipped.

## Limits

- LegendKeeper allows 120 writes per minute and 3,000 per hour per key. The plugin paces itself, honors `Retry-After`, and resumes automatically; a first publish of a large vault takes a while.
- A failed note does not stop the run. Failures are listed at the end and appear again in the next review.
- Two devices publishing at the same moment is not supported.
- Not in this version: two-way sync, adopting pages that already exist in LegendKeeper, infobox mapping, per-note diffs.

## Development

```bash
npm install
npm test        # unit tests
npm run build   # typecheck + production bundle (main.js)
npm run dev     # watch mode
```

If `npm test` fails with a missing `@rolldown/binding-…` module on Apple silicon running an x64 Node, install the matching binding: `npm install --no-save @rolldown/binding-darwin-x64`.

`tests/fixtures/vault` is a small vault for trying the plugin by hand. Symlink or copy this folder into a test vault's `.obsidian/plugins/legendkeeper-publish`, and use a separate LegendKeeper test project and API key.

The design and requirements live in `openspec/changes/add-legendkeeper-publish`.
