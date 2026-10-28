# Contributing

Thanks for helping. This is a small project with a few firm habits; following them keeps it small.

## Before you code

For anything bigger than a fix, open an issue first: what you want to do, and why. That saves both of us from a pull request that doesn't fit.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars        # APP_KEY; LLM_API_KEY is optional
npx wrangler d1 migrations apply anki-everything --local
npm run dev
```

Without `LLM_API_KEY` the app runs in No AI mode only, which is enough for most UI work.

## Architecture rules

- **Card HTML is rendered in one place:** [`src/shared/render.ts`](src/shared/render.ts). The server stores structured JSON only.
- **The model's output format lives in one place:** [`src/worker/services/contract.ts`](src/worker/services/contract.ts). User prompts only say how to explain; never move format rules into a prompt.
- **No personal prompts in the repo.** Only [`prompts/examples`](prompts/examples). Real prompts live in the app's Settings, or in `prompts.local/`, which is gitignored.
- **Schema changes are new migrations** in `migrations/`, never edits to old ones.
- **Card style changes** bump `NOTETYPE.version`, so existing AnkiDroid installs pick them up on next launch.
- **Status changes go through `canMove`** in [`src/shared/capture.ts`](src/shared/capture.ts).

## UI rules

- **No hard-coded UI text.** All copy lives in [`src/client/i18n`](src/client/i18n).
- **Fewer words.** Buttons say the action. Don't explain what's obvious. Errors say what happened and what to do.
- **The photo is the hero; the highlighter yellow is the only accent.** Everything else stays black, white and grey. One highlighter-coloured button per screen at most.
- **Thumb zone.** Primary actions sit at the bottom or right, at least 44 px tall.
- **Reuse the building blocks** in [`src/client/ui.tsx`](src/client/ui.tsx) and [`src/client/back.ts`](src/client/back.ts):
  - anything that can be closed registers with the back stack (`useBack`), so Android's back gesture closes the top layer instead of leaving the app;
  - bottom sheets use `Sheet`; confirmations use `ask()`, never `window.confirm` (native dialogs show English buttons and don't match);
  - feedback: `haptic.tap()` on press, `haptic.success()` on completion; transitions use the shared `spring`.
- **Motion only in response to the user**, and `prefers-reduced-motion` is respected.

## Pitfalls we already hit

- **Only `html` scrolls.** If `body` also gets `overflow`, it becomes an empty scroll container, and with `overscroll-behavior` Android WebView touch scrolling gets stuck on it. Block horizontal scrolling with `overflow-x: clip`, not `hidden`. Desktop browsers don't show this bug.
- **Labels inside controls need `white-space: nowrap`.** Long German words are allowed to break anywhere, and without `nowrap` a squeezed filter label breaks too.
- **A refetch must not overwrite edits.** Drafts only take server data when its content actually changed (`useServerCard` in the detail page).
- **A browser preview is not a phone.** Gestures, the back button, the status bar and vendors freezing AnkiDroid in the background only show up on a device.

## Checks

```bash
npm run format        # Prettier
npm run typecheck
npm test
```

CI runs the same commands on every pull request. If you change something only a phone can show (gestures, the back button, AnkiDroid writes), say in the pull request what you tested on a device.

## License

By contributing you agree that your contributions are licensed under [AGPL-3.0](LICENSE).
