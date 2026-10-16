# LegendKeeper Publish

Write in Obsidian, publish to [LegendKeeper](https://www.legendkeeper.com). This plugin works like Obsidian Publish, but the destination is your LegendKeeper world: it keeps track of which notes changed, shows you a review, and sends only what you choose.

> **Beta.** This plugin is new and has had limited testing. It only ever creates, edits and trashes pages that it created itself, and trashed pages can be restored in LegendKeeper. Even so, try it on a **separate LegendKeeper test project** before pointing it at a world you care about.

## What you need

- Obsidian **1.11.4 or later**
- A LegendKeeper project on a **paid plan**. LegendKeeper API keys are not available on a trial.
- A LegendKeeper **API key** for that project (steps below)

## Install (beta)

The plugin is not in Obsidian's community plugin list yet. The easiest way to install it is with the **BRAT** plugin, which also keeps the beta up to date.

1. In Obsidian, go to **Settings → Community plugins**, turn off Restricted mode if asked, choose **Browse**, and install **Obsidian42 - BRAT**. Enable it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Paste `phd20/legendkeeper-publish` (or the full address, https://github.com/phd20/legendkeeper-publish) and choose **Add plugin**.
4. Go to **Settings → Community plugins** and enable **LegendKeeper Publish**.

To install by hand instead, download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/phd20/legendkeeper-publish/releases/latest) and put them in a folder named `legendkeeper-publish` inside your vault's `.obsidian/plugins/` folder. Then enable the plugin.

## Set up

1. **Create an API key.** In LegendKeeper, open your project's settings, choose **Developers**, and create an API key. A key belongs to one project. If you want to publish hidden (GM-only) pages, the key needs the **admin** role.
2. **Add the key to Obsidian.** Open **Settings → LegendKeeper Publish**. Under **API key**, choose or create a secret and paste the key. Obsidian stores it in its secret storage, not in your vault.
3. **Connect.** Choose **Connect**. The plugin shows the name of your LegendKeeper project.
4. **Pick a mount point.** This is the LegendKeeper page that everything is published under. Choose **Create "your vault name"** to make a new top-level page, or **Choose existing** to use one you already have. The plugin never touches pages outside it.

Publishing is switched off until all four steps are done. The status bar says `LK: set up` until then.

The API key is stored per device. If you use Obsidian on more than one device, enter the key on each.

## Publish

Open the command palette (or use the cloud icon in the left ribbon, or click the status bar item):

| Command | What it does |
|---|---|
| **Publish changes…** | Opens a review of everything that changed in the vault |
| **Publish current note…** | Reviews only the open note, plus any new folders it needs |
| **Reset publish state** | Makes the plugin forget what it has published. Nothing changes in LegendKeeper. |

The status bar shows how much is waiting, for example `LK: 7 unpublished`. That number is a quick estimate; the review shows the exact list.

Nothing is sent until you press **Publish** in the review.

### The review

Changes are grouped, and you choose what to send:

| Group | Ticked at first? | What it means |
|---|---|---|
| New | Yes | Notes not yet in LegendKeeper |
| Changed | Yes | Notes whose published content would change |
| Moved / renamed | Yes | Notes moved to another folder or renamed |
| Required parents | Automatic | New folders that ticked notes need. They tick themselves. |
| Edited in LegendKeeper | No | Pages someone also changed in LegendKeeper since your last publish. Ticking one **overwrites** those LegendKeeper edits. |
| Deleted | No | Notes you removed or excluded. Ticking one moves its page to the LegendKeeper trash, where it can be restored. |

Each group has **All** and **None** buttons. Rows with warnings (for example a link to a note that isn't published) have a "warnings" link you can open.

Your **first publish** lists every note in the vault as New. Untick anything you don't want sent.

A note only counts as **Changed** when what would appear in LegendKeeper changes, so editing whitespace doesn't trigger it. Publishing a note can also mark other notes as Changed, because their links to it turn into real LegendKeeper links.

If some notes fail, the rest still publish. The summary lists the failures with an error code and request ID, and failed notes show up again next time.

## How your notes become LegendKeeper pages

- **Notes** become pages. The page name is the note's `title` property if it has one, otherwise the file name.
- **Folders** become pages too. If a folder contains a note with the same name (`Lore/Lore.md`), that note is the folder's page. Otherwise the folder page lists its contents. A folder is only created if something inside it is published.
- **Links** like `[[Aldric the Bold]]` and `[[Aldric the Bold|the king]]` become LegendKeeper links. A link to a note that isn't published becomes plain text, with a warning in the review.
- **Images** (PNG, JPEG, GIF, WebP) are uploaded to your LegendKeeper project's assets, into a folder named after your vault. An image used in several notes is uploaded once.
- **Order:** new pages go after their siblings, folders first then alphabetical. The plugin never reorders pages afterwards, so rearranging them in LegendKeeper is safe.

### Properties the plugin reads

| Property | Effect |
|---|---|
| `publish: false` | The note is not published. You can change the property name in settings. |
| `title` | The page name |
| `tags` and `#tags` in the text | Page tags. Nested tags such as `place/city` are kept as written. |
| `aliases` | Page aliases |
| `lk-icon`, `lk-color`, `lk-shape` | The page's icon (a [Font Awesome](https://fontawesome.com/icons) name such as `crown`), a `#RRGGBB` color, and a map pin shape (`pin`, `diamond`, `flag`, `marker`, `shield`, `circle`, `banner`, `arch` or `none`) |
| `lk-hidden: true` | Publishes the page hidden from players. You can change the property name in settings. |

Other properties are ignored.

### Hidden (GM-only) content

- Put `lk-hidden: true` on a note to publish it hidden from players, or turn on **Publish pages hidden by default** in settings and use `lk-hidden: false` on notes that should be visible.
- Publishing hidden pages needs an **admin** API key. With any other key those notes fail with a clear message. The plugin never publishes a note visibly because hiding failed.
- Hiding is set **per page**. Don't rely on a hidden folder to hide the pages inside it. Put the property on every page that must stay hidden, or use the hidden-by-default setting.
- To hide just part of a note, use a secret callout:

  ```
  > [!secret]
  > Only the GM should see this.
  ```

  It becomes a secret block in LegendKeeper.

### What converts, and what doesn't

Converted: headings, paragraphs, bold, italic, strikethrough, `==highlight==`, inline code, links, lists, task lists, tables, code blocks, quotes, horizontal rules, callouts and image embeds. Other callouts map to the closest LegendKeeper style.

Removed: `%%comments%%` are never published.

Published as plain text or code, with a warning: embedded notes (`![[Note]]` becomes a link), footnotes, math, Mermaid diagrams, Dataview queries and raw HTML.

Skipped, with a warning: embedded PDFs, audio, video, SVG and other non-image files.

## Privacy and safety

- **Network use.** The plugin connects to `www.legendkeeper.com` and nowhere else. It does so only when you open a review, connect in settings, or publish. It sends your API key to LegendKeeper to authenticate, and, when you publish, the text, tags, aliases and images of the notes you selected. It has no analytics or tracking.
- **Your API key** is kept in Obsidian's secret storage. It is never written to your vault, to the plugin's data file, or to the console.
- **What stays in your vault.** The plugin's `data.json` holds your settings and a record of which note matches which LegendKeeper page (page IDs and content fingerprints, not note text). It syncs with your vault.
- **Publishing is one-way.** The plugin never reads LegendKeeper content back into your notes, and it never deletes a note from your vault.
- **Pages it did not create are left alone.** If a page with the same name already exists in LegendKeeper but was not made by this plugin, you will get a second page, not an overwrite.
- **If the plugin forgets what it published** (for example you uninstalled it, or reset the publish state), publishing again finds the pages it created before and updates them instead of making duplicates. This works when the project, mount point, vault name and note paths are the same as before. A note you renamed or moved while the plugin had no record of it is published as a new page.
- **What publishing overwrites.** Publishing a note replaces that page's main content and its name, tags, aliases and icon with what is in your note. Other things on the LegendKeeper page (extra documents, sidebar properties, permissions) are not touched.

## Limits and known issues

- **One-way only.** There is no two-way sync, and no way to adopt LegendKeeper pages that already exist.
- **Edits made in LegendKeeper to a page's name, tags or icon** are overwritten the next time that note is published. Edits to its content are flagged first.
- **Large vaults.** LegendKeeper allows 120 writes a minute and 3,000 an hour per key. The plugin slows itself down to stay under that and resumes on its own, so a first publish of hundreds of notes takes a while.
- **Renames made outside Obsidian** (for example by file sync) are usually recognised as a move, but can show as a deleted note plus a new one. Deleted is unticked, so the worst case is a duplicate page.
- **Disable, don't uninstall.** Uninstalling a plugin in Obsidian deletes its saved data, which includes the record of what was published. If you only want it out of the way, turn it off in **Settings → Community plugins** instead. Updating through BRAT is safe.
- **One device at a time.** Publishing from two devices at the same moment is not supported.
- **Mobile** is supported by design but has not been tested yet.
- Not included yet: infobox and sidebar property mapping, per-note change previews, LegendKeeper maps and timelines.

## Troubleshooting

| You see | What it means |
|---|---|
| "API key not set on this device" | Secrets don't sync between devices. Choose or enter the key in settings on this device. |
| Connect fails with "invalid or revoked" | The key was deleted or is wrong. Create a new one. |
| Connect fails with "paid plan" | LegendKeeper API keys need a paid plan; a trial doesn't count. |
| "API key isn't an admin key; hidden pages can't be published" | Create the key with the admin role, or remove the hidden property from those notes. |
| "Edited in LegendKeeper since the review" | The page changed in LegendKeeper after you opened the review. Open the review again and tick it under **Edited in LegendKeeper** to overwrite. |
| "Rate limited, resuming in …" | You hit LegendKeeper's limits. The plugin waits and carries on. |
| The review looks empty but notes changed | Check the note isn't excluded with `publish: false`, and that it isn't in a folder where every note is excluded. |

## Reporting problems

[Open an issue](https://github.com/phd20/legendkeeper-publish/issues/new/choose). Include the Obsidian version, whether you're on desktop or mobile, and the error text from the publish summary, including the code and request ID. Please never paste your API key.

## License

MIT. See [LICENSE](LICENSE). For development, see [CONTRIBUTING.md](CONTRIBUTING.md).
