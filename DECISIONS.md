# Decisions

One line per deviation from BRIEF v2, with the reason.

| Date | Area | Decision | Rationale |
|---|---|---|---|
| 2026-11-18 | Platform | Windows 10 2004+ / Windows 11 only for now; macOS code paths deferred. | Owner's call: ship and verify on the machine we can test on. |
| 2026-11-18 | Storage | `node:sqlite` (built into Electron 45 / Node 24) instead of `better-sqlite3`. | better-sqlite3 has no prebuilt binary for Electron 45 and building needs Visual Studio; node:sqlite needs no native build and was verified in Electron 45 with FTS5 (SQLite 3.54.1). |
| 2026-11-18 | Stack | React 18.3 kept per brief; TypeScript pinned to 5.9.3. | typescript-eslint 8.73 supports TypeScript < 6.1. |
| 2026-11-18 | Build | electron-vite 6 on Vite 8 (Rolldown); configs are `.mts`. | Current stable toolchain; ESM configs avoid Vite's CommonJS loader warning. |
| 2026-11-18 | ASR | Local sherpa-onnx streaming ASR is primary; Groq Whisper is optional, and only for re-transcribing trigger utterances. whisper.cpp and the 1.5s-overlap/LCS de-duplication step are dropped. | Owner wants free + fast. Groq's free tier allows 20 req/min, but 1.5s chunks for two sources need ~80. A streaming recogniser produces no overlapping chunks to de-duplicate. |
| 2026-11-18 | LLM | Claude Haiku 5.5 primary (thinking disabled for answers); Groq `gpt-oss-120b` free fallback; Claude Sonnet 5.5 for "elaborate". | Fast time to first token and good accuracy at ~$0.0004/answer; a zero-cost path when no Anthropic key is set. |
| 2026-11-18 | Loopback | Electron's built-in `setDisplayMediaRequestHandler({ audio: 'loopback' })` instead of `naudiodon`. | naudiodon is unmaintained; the built-in path needs no native addon. Trade-off: it captures the default output device only. |
| 2026-11-18 | Answers | New: notes-folder retrieval (FTS5 + local embeddings), searched before every answer. | Owner requirement: answers come first from their own interview notes and prepared answers. |
| 2026-11-18 | Capture hiding | Glimpse sets the display affinity itself with koffi before the overlay is shown, reads it back, and hides the overlay again if Windows reports it capturable (fail closed). | Measured on Windows 11 build 26300: Electron applies `WDA_EXCLUDEFROMCAPTURE` only when a window is shown and clears it on hide, which leaves a possible one-frame gap. |
| 2026-11-18 | Hotkeys | Default show/hide is `Ctrl+Alt+G`, not `Ctrl+Alt+Space`. A registration failure raises a notification and is flagged in Settings. | `Ctrl+Alt+Space` is Claude Desktop's Quick Entry shortcut: the first e2e run lost the key to it and the failure was silent. |
| 2026-11-18 | Click-through | Whole panel passes mouse events through while click-through is on; only the header controls are a hit-box, polled every 60 ms. | The brief's "re-enable events only inside the panel hit-box" needs a hit-box smaller than the panel, otherwise click-through on could never let a click reach the app behind (gate G3). |
| 2026-11-18 | Self-test | Adds a baseline capture (overlay hidden) and a positive control (protection briefly off); PASS needs both. Diff images are shown but never persisted. | A bare "no canary pixels" result also passes if the overlay is off-screen; wallpaper can be magenta/green; the images are screenshots of the user's screen. |
| 2026-11-18 | Win10 < 2004 | Capture-safe mode (alpha 0.15) is shown as a status badge in Settings, not as a one-time dialog. Not tested: no such machine. | Keeps the first pillar free of modal dialogs; behaviour implemented from the brief. |
| 2026-11-18 | Panic | `PanicController.captureMuted` and `onCaptureMuted()` are the hook Pillar B must honour; nothing is captured yet, so nothing is muted yet. | Audio capture does not exist until Pillar B. |
| 2026-11-18 | macOS-only calls | `setVisibleOnAllWorkspaces`, `app.dock.hide()` and the NSWindow shim are omitted. | Windows-only scope; they are no-ops or absent on Windows. |
| 2026-11-18 | Dev flags | `--selftest` and `--canary=<seconds>` run headless against a throwaway profile. | Lets the capture claim be verified without a UI and from CI-less machines. |
