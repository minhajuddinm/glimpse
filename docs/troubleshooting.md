# Troubleshooting

## Installing and starting

**"Windows protected your PC" when running the installer.**
The installer isn't code-signed. Click **More info → Run anyway**. See [Install](install.md#windows-protected-your-pc).

**Nothing happens after installing.**
Glimpse starts in the system tray. Click **^** at the bottom-right of the taskbar and click the Glimpse icon to open Settings.

**Glimpse won't start after installing to another drive.**
Its data folders are created next to the install folder, for example `D:\Apps\Glimpse Data`. If Windows doesn't let your account create folders there, reinstall to a folder you own. See [Where your data lives](install.md#where-your-data-lives).

**The installer stops with an error, or an update doesn't take effect.**
Glimpse, or something reading its files, is still running. Quit it from the tray (**right-click → Quit Glimpse**), wait a few seconds, and run the installer again. If it still fails, restart Windows and try once more.

## The overlay

**I can't see the panel.**
- Press `Ctrl+Alt+G`, or use the button at the bottom of the Settings sidebar.
- **Viewing the PC remotely?** Moonlight, Parsec, Remote Desktop, AnyDesk and TeamViewer can't show the panel, because it's hidden from screen capture. Sit at the PC, or use the [companion page](companion.md).
- **Panic hide on?** Press `Ctrl+Alt+H` again.

**The panel shows up in my screen share.**
Run **Capture test** and report the app and result in an issue. The panel is excluded from capture through a Windows feature that needs Windows 10 version 2004 or later; check with `winver`.

**I can't click the window behind the panel.**
Click-through is probably off: the badge at the top says **INTERACTIVE**. Press **Lock** or `Ctrl+Alt+C`.

**A hotkey does nothing.**
Another app owns it. Glimpse marks it in **Settings → Hotkeys**: pick a different one.

## Audio and transcript

**The "Them" meter doesn't move.**
Glimpse captures what your default playback device plays. Make sure the call's audio goes to the default output in **Windows Settings → System → Sound → Output**.

**The "You" meter doesn't move.**
- Choose your mic in **Audio → Microphone**.
- Allow microphone access in **Windows Settings → Privacy & security → Microphone**, including **Let desktop apps access your microphone**.
- Check that **You** isn't muted (`Ctrl+Alt+M`).

**My words show up as "Them" too, or appear twice.**
You're on speakers, so the mic hears the call. Glimpse filters most of this out, but **headphones** fix it completely.

**The transcript is inaccurate.**
Try the **Nemotron** model in **Audio → Speech recognition**: it's larger and more accurate. Speak clearly, and use a headset mic if you can.

## Answers

**No answers appear.**
- Check **Answers → Answer automatically** is on, or press `Ctrl+Alt+Enter`.
- Check a key is saved (**Answers → AI provider**), and test it in **Try it**.
- Glimpse answers questions from **the other side**. To test on your own, play a video of someone asking a question, or use **Try it**.

**Answers are generic or invent details.**
Add your details to **Answers → About you** and to the [notes folder](notes.md). Use the Anthropic key: it sticks to your notes more closely than the free Groq model.

**"Rate limit" or slow answers with Groq.**
Groq's free tier allows a few answers a minute. Wait a moment, or add an Anthropic key.

## Meetings and calendar

**A call wasn't recorded automatically.**
- Turn on **Meetings → Record calls I join automatically**.
- In a browser, the call tab must be in front, or the meeting must be on your connected calendar.
- If you joined without audio, start the meeting with `Ctrl+Alt+N`.

**No minutes were written.**
Minutes need an API key, and a meeting with at least about 25 words. Open the meeting and click **Write minutes**.

**Calendar problems:** see the table at the end of [Calendar](calendar.md#if-something-goes-wrong).

## Still stuck?

[Open an issue](https://github.com/minhajuddinm/glimpse/issues/new/choose) with your Windows version (`winver`), the Glimpse version (bottom of the Settings sidebar), what you did, and what happened. **Never include API keys, calendar links or personal notes.**
