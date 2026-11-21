# Overlay, answers and hotkeys

## The panel

The overlay is a slim panel on the right of your main screen. It shows answers at the top and the live transcript below them.

- **Show or hide it:** press `Ctrl+Alt+G`, use the sidebar button in Settings, or use the tray menu. To show it every time Glimpse starts, turn on **General → Show overlay when Glimpse starts**.
- **It never takes focus.** Showing or hiding it doesn't steal the cursor from the app you're typing in.
- **Hidden from capture.** Windows is told to leave it out of every screen capture, and Glimpse then checks that Windows really did. If Windows says the panel can be captured, Glimpse hides it rather than risk it showing.
- **Opacity:** **General → Opacity** lets you see more of the app behind it.

### Click-through

By default **clicks go through the panel** to the app behind it, so it never gets in the way. Only the small **Unlock** button stays clickable. To click inside the panel, for example to scroll, press **Unlock** (or `Ctrl+Alt+C`), and press **Lock** when you're done.

### Panic hide

`Ctrl+Alt+H` instantly hides the panel and the tray icon and stops listening. Press it again to bring everything back.

## Answers

When the other side asks a question, Glimpse answers on the panel in under 55 words, with no preamble. Answers based on your notes show the source file underneath.

- **Answer automatically** (on by default, **Answers → When to answer**): answers each question the other side asks. Turn it off to answer only when you press `Ctrl+Alt+Enter`.
- **Fact-check claims** (off by default): flags numbers, dates and names the other side states, as ✓ correct, ✗ wrong or ⚠ unsure.
- **Answer from a screenshot** (`Ctrl+Alt+S`): Glimpse looks at your screen, for example a coding problem or a slide, and answers about it. The screenshot is used only for that one request and is never saved.
- **Elaborate** (`Ctrl+Alt+E`): a fuller answer to the last question, written by the larger model.
- **Answer mode** (**General → Answer mode**) shapes the tone:

| Mode | For |
|---|---|
| Interview | First-person answers from your experience |
| Technical | Precise answers that name the key trade-off |
| Sales call | Objections, needs and next steps |
| General | Helpful replies for any conversation |
| Recap | Decisions, open questions and next steps so far |

## Hotkeys

They work from any app. You can change them all in **Settings → Hotkeys**.

| Action | Default |
|---|---|
| Show / hide the overlay | `Ctrl+Alt+G` |
| Click-through on / off | `Ctrl+Alt+C` |
| Panic hide / restore | `Ctrl+Alt+H` |
| Answer the last question now | `Ctrl+Alt+Enter` |
| Elaborate on the last answer | `Ctrl+Alt+E` |
| Regenerate the last answer | `Ctrl+Alt+R` |
| Answer from a screenshot | `Ctrl+Alt+S` |
| Mute / unmute your mic | `Ctrl+Alt+M` |
| Clear answers | `Ctrl+Alt+X` |
| Start / stop a meeting | `Ctrl+Alt+N` |

If another app already uses a shortcut, Glimpse shows a notification and marks it in **Settings → Hotkeys**. Pick a different one there.

## Audio

The **Audio** tab shows two sources:
- **Them:** whatever your PC plays, meaning the other side of the call.
- **You:** your microphone.

Each has a level meter and a mute button. Speech recognition runs on your PC with the Kroko model. **Nemotron** is a larger, slower and slightly more accurate option. If your mic is unplugged, Glimpse carries on with system audio and switches back when the mic returns.

**When Glimpse listens** (**Meetings → Meeting settings**):
- **Always** (the default): live answers work any time.
- **Only during meetings:** the mic and system audio stay off until you start a meeting.

## Check that it really is invisible

Screen capture works differently in every app, so **test the app you actually use**. Go to **Settings → Capture test**.

1. **Self-test.** Glimpse paints the panel with a bright pattern, captures the screen the way a recorder would, and looks for the pattern. It should say **PASS**. Don't run it while you're sharing your screen: for about half a second it turns protection off, to prove the test can see the panel at all.
2. **Live test**, with your real app (Zoom, Meet and so on), while sharing or recording:
   - **Step 1, control (5 s):** shows the pattern without protection. It **must** appear on the other side. If it doesn't, the test can't tell you anything.
   - **Step 2, protected:** shows the pattern with protection on. It **must not** appear.

   Judge the result from the **viewer's side**, for example a phone that has joined the call.

**Using Parsec, Moonlight, Remote Desktop, AnyDesk or TeamViewer?** These capture the screen too, so the panel is invisible **to you** through them as well. That is the protection working. Sit at the PC itself, or use the [companion page](companion.md) on your phone.

### Capture test results

Tested on Windows 11 (build 26300). "PASS" means the panel was absent from the shared or recorded image.

| App | Result |
|---|---|
| Zoom screen share | PASS |
| Google Meet screen share | PASS |
| Microsoft Teams screen share | PASS |
| OBS Studio | PASS |
| Snipping Tool / `Win+Shift+S` | PASS |
| Xbox Game Bar recording | PASS |
| Loom | PASS |
| Discord screen share | PASS |
| Browser and Electron capture (automated test) | PASS |
| Classic GDI screenshot (automated test) | PASS |

On Windows 10 older than version 2004, Windows can only black the panel out, not hide it, so Glimpse makes it very faint instead. That mode hasn't been tested.

Tested another app? Please [open an issue](https://github.com/minhajuddinm/glimpse/issues/new/choose) with the result.
