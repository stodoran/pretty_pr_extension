# Pretty PR Review

Chrome extension (MV3, WXT + TypeScript) for calmer GitHub PR reviews. Works without a token, using your normal GitHub session.

## Features

### Moved code

Python functions and classes that moved, even renamed or modified, are tinted and labelled. Click a label to jump to the other end; **Show** lists every move, with a side-by-side **Compare** for modified ones.

![Moved functions labelled in the diff, with the moved-code panel open](docs/screenshots/moved-code.png)

### Auto-viewed tests and docs

Test and markdown files are marked as *Viewed* as they load, tagged **auto** so you can tell them apart from files you viewed yourself. Un-view one and it's left alone on that PR.

![Test files collapsed and tagged "auto"](docs/screenshots/auto-viewed.png)

### Definition search

Hover a `def`, `class` or `import` line to search the repo (default branch) for that name.

![Search button next to a function definition](docs/screenshots/definition-search.png)

### Settings

Toggle features, pick each feature's color, and choose which files are auto-viewed, with per-org and per-repo overrides.

![Settings: features and colors](docs/screenshots/settings.png)

![Settings: auto-viewed file patterns and overrides](docs/screenshots/settings-patterns.png)

## Setup

```sh
npm install
npm run build        # → dist/chrome-mv3
```

1. `chrome://extensions` → Developer mode → **Load unpacked** → `dist/chrome-mv3`.
2. Optional: open the extension's options page to edit test-file patterns.

No GitHub token is needed. The extension clicks GitHub's own Viewed toggles, and GitHub saves that state with your normal session.

`npm run dev` runs WXT with hot reload, using a separate Chrome profile.

## Layout

| Path | Role |
| --- | --- |
| `src/core/registry.ts` | Detects PR pages (including SPA navigation) and runs enabled features |
| `src/core/feature.ts` | `Feature` interface: add new augmentations as modules in `src/features/` |
| `src/core/test-files.ts` | Pure glob classifier (defaults → `owner/*` → `owner/repo`, last match wins, `!` negates) |
| `src/github/dom/` | All GitHub-markup knowledge (`DiffDomAdapter`), so UI changes break only this layer |
| `src/core/ui/status-dock.ts` | Floating status panel in a shadow root that features write to |

## Behaviour notes

- Test files are marked viewed as they render. GitHub only renders files near the viewport, so files further down get marked as you scroll. The "x / y viewed" counter fills in as you go.
- If you uncheck a test file yourself, or click **Undo**, that file is remembered for the PR and never auto-marked again there. Re-checking it clears that memory.
- When a new push changes a file you'd viewed, GitHub shows it as not viewed again. Test files get re-marked in that case, unless you had unchecked them yourself.
