# Pretty PR Review

Chrome extension (MV3, WXT + TypeScript) that augments GitHub PR review.

**v1:** on a PR's *Files changed* tab, test files and markdown files (configurable globs) are marked as viewed automatically.

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
