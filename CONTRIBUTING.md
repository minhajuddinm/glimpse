# Contributing to Glimpse

Thanks for helping! Bug reports, tested-app results, docs fixes and code are all welcome.

## Reporting a bug

[Open an issue](https://github.com/minhajuddinm/glimpse/issues/new/choose) and include:
- your Windows version (`winver`)
- the Glimpse version (bottom of the Settings sidebar)
- what you did, what you expected, and what happened

**Never paste API keys, calendar links, Google client secrets, or personal notes** into an issue. Screenshots of Glimpse's own windows are fine; crop out anything private.

**Capture results** are especially useful: did the overlay stay hidden in some app's screen share or recording? Say which app and version, and how you checked it (ideally from the viewer's side).

## Making a change

1. Fork the repo and create a branch.
2. Follow [Building from source](docs/building.md) to run it.
3. Make your change, with tests where it makes sense (`tests/`, Vitest).
4. Run `npm run check`. It must pass: typecheck, lint and tests.
5. Open a pull request saying what changed and why, and how you tested it.

## Code rules

- **TypeScript strict:** no `any`, no `@ts-ignore`, no `TODO`s left in code.
- **IPC:** every message between the main process and the UI goes through the Zod schemas in `src/shared/ipc.ts` (with the allow-list in `src/shared/channels.ts`).
- **Secrets:** stored only through `SecretStore` (encrypted with `safeStorage`). Never logged, and never sent to the renderer.
- **Privacy:** no telemetry, and no new network destinations without a clear reason. Audio never leaves the machine.
- **User-facing text:** plain English, short sentences, and say what to do next.
- **Decisions:** if you deviate from an existing design decision, add a line to [DECISIONS.md](DECISIONS.md) explaining why.

## Ground rules

Be kind and constructive. Glimpse is meant to help people in conversations they consent to. Changes whose main purpose is to deceive or covertly record people won't be accepted.
