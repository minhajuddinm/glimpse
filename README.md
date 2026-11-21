<p align="center"><img src="build/icon.png" alt="Glimpse logo" width="110" /></p>

<h1 align="center">Glimpse</h1>

<p align="center">
  An invisible call copilot for Windows: it listens to your call, transcribes it on your PC,<br />
  and shows short answers from <b>your own notes</b> in a side panel that screen sharing can't see.
</p>

<p align="center">
  <a href="https://github.com/minhajuddinm/glimpse/releases/latest"><b>Download for Windows</b></a> ·
  <a href="docs/install.md">Install guide</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="docs/troubleshooting.md">Troubleshooting</a>
</p>

---

## What it does

- **Hidden from screen sharing and recording.** The answer panel stays off Zoom, Google Meet, Teams, OBS, Loom, Discord, Snipping Tool and Xbox Game Bar captures, all tested by hand on Windows 11 ([full results](docs/overlay.md#capture-test-results)).
- **Live transcript of both sides.** It hears your microphone and the other side of the call. Speech recognition runs **on your PC**: free and offline, with about half a second of delay.
- **Answers from your notes first.** Put your resume, prepared interview answers or product notes in a folder. When someone asks a question, Glimpse finds the matching note and shows a short answer in under a second.
- **Meeting minutes.** Record a meeting (or let Glimpse start when you join a call) and get a summary, decisions and action items saved as Markdown.
- **Calendar briefs.** Connect Google Calendar, Outlook or iCloud. Five minutes before a meeting, Glimpse tells you who you are meeting and what to prepare.
- **Your keys, your data.** There's no account, no server and no telemetry. You bring your own AI key (Anthropic, or Groq's free tier), and everything else stays on your PC.

## Quick start

1. **Install.** Download `Glimpse.Setup.x.y.z.exe` from [Releases](https://github.com/minhajuddinm/glimpse/releases/latest) and run it. Windows may warn that the app is unrecognised: click **More info → Run anyway** ([why](docs/install.md#windows-protected-your-pc)).
2. **Add an AI key.** Open Glimpse from the system tray, go to **Answers**, and paste an [Anthropic key](docs/api-keys.md#anthropic-recommended) (best answers, about $0.04 per hour of calls) or a [free Groq key](docs/api-keys.md#groq-free).
3. **Add your notes.** Go to **Notes → Add files…** and add your resume, prepared answers and so on ([how to write notes that work well](docs/notes.md)).
4. **Show the panel.** Press `Ctrl+Alt+G`. Join a call and questions get answered on their own, or press `Ctrl+Alt+Enter` to answer now.
5. **Check it is invisible.** Run **Capture test** once with the app you share your screen in ([how](docs/overlay.md#check-that-it-really-is-invisible)).

## Documentation

| Guide | What's in it |
|---|---|
| [Install](docs/install.md) | Requirements, the installer, where your data lives, updating and uninstalling |
| [API keys](docs/api-keys.md) | Getting an Anthropic or Groq key, what it costs, and where to paste it |
| [Notes folder](docs/notes.md) | Which files work, how to write prepared answers, testing a search |
| [Overlay, answers and hotkeys](docs/overlay.md) | The panel, click-through, panic hide, every hotkey, answer modes, the capture test |
| [Meetings and minutes](docs/meetings.md) | Recording meetings, auto-recording calls you join, minutes |
| [Calendar](docs/calendar.md) | Sign in with Google (step by step), or a secret iCal address (Google, Outlook, iCloud) |
| [Companion page](docs/companion.md) | Seeing the transcript and answers on your phone or a second computer |
| [Privacy](docs/privacy.md) | What stays on your PC, what's sent where, and how secrets are stored |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and fixes |
| [Building from source](docs/building.md) | Developer setup, scripts, project layout |
| [DECISIONS.md](DECISIONS.md) | Design decisions and the reasons for them |

## Requirements

- **Windows 11**, or Windows 10 version 2004 or later.
- About 1 GB of free disk space. A recent CPU helps; no GPU is needed.
- An Anthropic or Groq API key for AI answers. Without one, prepared answers from your notes still appear.

A macOS build exists but is experimental and untested on real Macs: see [Building from source](docs/building.md#macos-experimental).

## Use it responsibly

Recording and transcription laws differ by place, and many require everyone on a call to agree. **Tell the other people when Glimpse is transcribing**, and follow the rules of any interview, exam or platform you use it with. You are responsible for how you use it.

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
