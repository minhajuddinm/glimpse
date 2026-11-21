# Meetings and minutes

A **meeting** in Glimpse is a saved transcript. When it ends, the AI writes **minutes** for it. Everything is in the **Meetings** tab.

## Recording a meeting

- **Start:** click **Start meeting** in the Meetings tab, or press `Ctrl+Alt+N` from any app. You can give it a title. Without one, it takes the name of the calendar meeting happening now, if you've [connected a calendar](calendar.md).
- **Stop:** click **Stop and write minutes**, or press the same hotkey.
- While it runs, every transcript line is saved on your PC straight away. A crash or forced quit doesn't lose it: the meeting shows as **Interrupted**, and you can still write its minutes.

Only **text** is saved. Glimpse never stores audio.

## Record calls I join automatically

Turn on **Meetings → Meeting settings → Record calls I join automatically** (off by default).

Glimpse then starts a meeting **when you join a call** and stops it **when you leave**. It knows you've joined because a call app opens your microphone; Windows shows the same thing with the mic icon in the taskbar.

- **Works with:**
  - Zoom, Microsoft Teams, Webex, Slack huddles, Skype, GoTo Meeting and RingCentral.
  - Google Meet, Teams or Zoom in Chrome, Edge, Brave, Firefox, Opera or Vivaldi. A browser counts only when a call tab is in front, or when your calendar has a meeting with a call link happening now.
- **Start:** recording begins after the app has held the mic for **5 seconds**, so a quick mic test doesn't count.
- **Stop:** it stops about **20 seconds** after the app releases the mic, so switching headsets mid-call doesn't end the recording.
- **You stay in control:**
  - You get a notification at every start and stop.
  - If you stop a recording yourself, Glimpse won't restart it during that call.
  - It never stops a meeting you started yourself.
- **What it ignores:** a calendar meeting you don't join is never recorded. Other apps that use the mic (OBS, games, dictation tools) are ignored too.

**Limits:**
- **Silent joins:** if you join with "don't connect audio", or the app closes your mic completely while you're muted, Glimpse can't see the call. Press `Ctrl+Alt+N` instead.
- **Meet's lobby:** the "Ready to join?" screen already has your mic open, so recording may start a few seconds before you actually join.

## Minutes

When you stop a meeting, Glimpse writes the minutes with your AI provider: Claude Sonnet 5.5 with an Anthropic key, or gpt-oss on Groq. They have five sections:
- **Summary**
- **Decisions**
- **Action items**, as checkboxes: `- [ ] Owner — task (due date)`
- **Open questions**
- **Key details** (names, numbers, dates)

Click a past meeting to read its minutes and the full transcript. From there you can:
- **Copy** the minutes.
- **Export** the minutes and transcript as one Markdown file.
- **Rewrite minutes**, for example after you add an API key.
- **Rename** (pencil icon) or **Delete** the meeting.

Meetings with fewer than about 25 words get no automatic minutes, because they're usually a mis-click. You can still click **Write minutes** on them.

**Save minutes to the notes folder** (on by default) also saves each meeting's minutes as Markdown in `<notes folder>/Meetings/`. Later answers can then draw on past meetings, for example "what did we agree on pricing last week?". Transcripts stay inside Glimpse.

## Consent

Recording laws differ by place, and many require **everyone on the call to agree** to being recorded or transcribed. Tell the other people when Glimpse is transcribing.
