# Building from source

## Prerequisites

- **Windows 11** (or 10 version 2004 or later)
- **[Node.js](https://nodejs.org) 22 or later** (developed on 24)
- **[Git](https://git-scm.com)**

No Visual Studio or other native build tools are needed: the native modules ship prebuilt binaries.

## Run it

```powershell
git clone https://github.com/minhajuddinm/glimpse.git
cd glimpse
npm install
npm run fetch-models -- --only kroko-en,silero-vad,bge-small-en   # about 200 MB: speech, voice detection, notes search
npm run dev
```

Glimpse appears in the system tray, and the Settings window opens. When run from source on a drive other than C:, its data goes to `.glimpse-data/` and its notes to `notes/` in the repo (both git-ignored).

## Build the installer

```powershell
npm run dist   # → release\Glimpse Setup x.y.z.exe
```

The installer bundles the Kroko speech model, the Silero voice detector and the notes-search model, so fetch them first (above). Download caches are kept in `.cache/`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run check` | Typecheck, lint and unit tests. Run it before every pull request |
| `npm run dist` | Build the Windows installer |
| `npm run selftest` | Build, then run the capture self-test headless (exit code 0 = PASS) |
| `npm run canary` | Show the test pattern on the protected overlay for 60 s, for checking external recorders |
| `npm run fetch-models` | Download speech models into `models/` (all candidates ~1.1 GB; `--only` to pick; hashes are verified) |
| `npm run bench:audio` / `bench:asr` / `bench:pipeline` | Make benchmark audio with Windows voices, then measure the speech models and the live pipeline |
| `npm run bench:kb` | Notes-search accuracy |
| `npm run bench:answer` | Time to first words with the keys saved in Settings (close the app first) |
| `npm run bench:minutes` | Minutes for a scripted sample call, checked for sections and key facts |
| `npm run icons` | Regenerate the app icons from `build/icon-source.png` |

## Project layout

```
src/
  main/            Electron main process
    overlay.ts       the capture-protected overlay window
    protection.ts    WDA_EXCLUDEFROMCAPTURE + read-back check
    clickthrough.ts  mouse pass-through hit-testing
    audio/ asr/      capture pipeline, local speech recognition (sherpa-onnx) in a utility process
    transcript/      rolling transcript, echo guard
    answers/         question detection, prompts, Anthropic and Groq providers
    kb/              notes folder: parsers, chunking, local embeddings, hybrid search
    meetings/        meeting store, minutes, call detection (detect.ts)
    calendar/        iCal parsing, Google Calendar API + sign-in
    companion/       the local companion web page
    selftest/        capture self-test
  preload/         the narrow, typed bridge to the renderer
  renderer/        React UI: Settings pages, the overlay, the hidden capture page
  shared/          types and Zod schemas shared by both sides (IPC contract in ipc.ts)
tests/             Vitest unit tests
scripts/           model download, benchmarks, packaging
build/             icons and installer resources
docs/              user guides
```

**Conventions:**
- TypeScript strict, with no `any` and no `@ts-ignore`.
- Every IPC message is validated with Zod (`src/shared/ipc.ts`).
- Secrets are stored only through `SecretStore` (Electron `safeStorage`) and never reach the renderer.
- Design decisions and their reasons are in [DECISIONS.md](../DECISIONS.md).

## macOS (experimental)

The code builds for macOS, and `.github/workflows/mac.yml` produces arm64 and x64 DMGs, but it has **not been tested on a real Mac**.

**Requirements and setup:**
- macOS 13 or later. System audio needs 14.2 or later.
- The app isn't notarised: right-click → **Open** on first launch.
- macOS's "don't share this window" flag can be ignored by apps that record through ScreenCaptureKit (macOS 15+). Always run the capture test.
- To build on a Mac: `npm ci && npm run fetch-models -- --only kroko-en,silero-vad,bge-small-en && npm run dist`.

Call detection and the Windows-specific capture checks are Windows-only.
