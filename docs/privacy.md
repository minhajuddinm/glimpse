# Privacy

Glimpse has **no account, no server and no telemetry**. The project never receives anything you do with it.

## What stays on your PC

- **Audio.** It's transcribed on your PC and never uploaded or saved.
- **Transcripts and meetings.** They're saved in Glimpse's local database.
- **Your notes.** They're indexed and searched on your PC by a small local model.
- **Settings.** Your API keys, Google sign-in and calendar address are **encrypted** with Windows (DPAPI through Electron's `safeStorage`). Only your Windows account can read them, and they're never shown again in the app.
- **Screenshots** for "answer from a screenshot" are held in memory for that single request and never saved.
- **Self-test images** aren't saved either.

## What is sent, and to whom

| When | What | To |
|---|---|---|
| An answer is written | The last few minutes of transcript, the matching passages from your notes, your **About you** text, and a screenshot if you asked for one | The AI provider whose key you saved (Anthropic or Groq) |
| Minutes are written | That meeting's transcript | The same provider |
| A brief is written | The calendar invite (title, time, attendees, description) and matching notes | The same provider |
| The calendar syncs | A read request for your events | Google, or your calendar provider's iCal link |

The providers' own policies apply to what they receive: see [Anthropic](https://www.anthropic.com/legal/privacy) and [Groq](https://groq.com/privacy-policy/). Both offer API terms under which data isn't used to train their models by default. Check the current terms yourself.

## Companion page

It's served from your PC only, with a random access code. See [Companion page](companion.md).

## Deleting your data

- **Meetings:** delete them one by one in the **Meetings** tab.
- **Keys:** click **Remove** on the **Answers** page.
- **Calendar:** click **Disconnect** in the **Calendar** card.
- **Everything:** uninstall Glimpse, then delete the data and notes folders listed in [Install → Where your data lives](install.md#where-your-data-lives).
