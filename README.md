# Glimpse

A real-time conversation copilot for **Windows**. It listens to your call (your microphone plus the other side's audio), transcribes it locally, and shows short answers in a side panel. The panel is hidden from screen sharing and recording. Answers come from **your own notes folder first**, for example your interview notes and prepared answers.

> **Status: early development.** Milestone M0 (project scaffold) is done. The overlay, audio capture, live answers and notes search are being built in that order. The checklist below tracks what works today.

## Requirements

- Windows 11, or Windows 10 version 2004 or later. Hiding from capture needs `WDA_EXCLUDEFROMCAPTURE`, which Windows added in 2004.
- Node.js 22 or later (developed on 24).
- Optional API keys:
  - **Anthropic** for the best answers (Claude Haiku 5.5, roughly $0.04 per hour of use).
  - **Groq** for free mode (free tier, lower answer rate).
- No Visual Studio or other native build tools are needed.

## Getting started

```powershell
npm install
npm run dev        # run with hot reload
npm run check      # typecheck + lint + unit tests
npm run dist       # build a Windows installer into release/
```

Glimpse runs in the system tray. Click the violet dot to open Settings.

## Privacy

- Speech recognition runs **on your machine**. Audio is never uploaded unless you turn on the optional cloud accuracy setting.
- Only the transcript excerpt and the matching snippets from your notes are sent to the LLM provider whose key you configure.
- There is no account and no telemetry. API keys are encrypted with Windows DPAPI through Electron `safeStorage`.

## Progress

| Milestone | What it delivers | Status |
|---|---|---|
| M0 | Electron + React + TypeScript strict, Zod-validated IPC, SQLite settings, tray | ✅ |
| A | Capture-invisible overlay, click-through, panic hide, capture self-test | ⏳ |
| B | Microphone + system audio, local streaming transcription, speaker labels | ⏳ |
| C | Question detection, live answers, modes, screenshot context, hotkeys | ⏳ |
| KB | Notes-folder search (Markdown/TXT/DOCX/PDF), instant prepared answers | ⏳ |

## Capture matrix (Windows)

Filled in during the Pillar A tests. "PASS" means the overlay is absent from the shared or recorded image.

| Tool | Result | Notes |
|---|---|---|
| Zoom screen share | — | |
| Google Meet (Chrome) share | — | |
| Microsoft Teams share | — | |
| OBS Display Capture | — | |
| OBS Window Capture (WGC) | — | |
| Snipping Tool / Win+Shift+S | — | |
| Xbox Game Bar recording | — | |
| Loom | — | |
| Discord screen share | — | |

## Project docs

- [DECISIONS.md](DECISIONS.md) lists each deviation from the original brief and why.
