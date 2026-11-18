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
