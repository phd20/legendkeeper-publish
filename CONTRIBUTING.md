# Contributing

## Build and test

```bash
npm install
npm test        # unit tests (vitest)
npm run lint    # eslint with the Obsidian plugin rules
npm run build   # typecheck + production bundle (main.js)
npm run dev     # watch mode
```

If `npm test` fails with a missing `@rolldown/binding-…` module on Apple silicon running an x64 Node, install the matching binding: `npm install --no-save @rolldown/binding-darwin-x64`.

## Trying it in Obsidian

Use a **separate test vault and a separate LegendKeeper test project** with its own API key. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/legendkeeper-publish/`, then enable the plugin. `tests/fixtures/vault` is a small sample vault; its README lists what the first review should show.

## Layout

| Path | Purpose |
|---|---|
| `src/convert` | Markdown to LegendKeeper blocks. Pure, no Obsidian or network. |
| `src/tracking` | Candidate scan, manifest, change planner, status estimate. Pure. |
| `src/lk` | LegendKeeper client, `requestUrl` fetch adapter, rate-limit pacer |
| `src/publish` | The executor and the vault-facing service |
| `src/review`, `src/settings` | Review dialog and settings tab |
| `openspec/` | Requirements (`specs/`) and the archived design for the first version |

## Releasing

Set the new version in `manifest.json`, `package.json` and `versions.json`, then push a tag with the same version number. The release workflow runs the tests, builds, and attaches `main.js`, `manifest.json` and `styles.css`.

## Security

Never commit an API key. `.lk-api-key` and `data.json` are git-ignored. The plugin pins its API host to `https://www.legendkeeper.com` on purpose; keep it that way.
