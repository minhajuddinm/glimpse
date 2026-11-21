# Install Glimpse on Windows

## Requirements

- **Windows 11**, or **Windows 10 version 2004 or later**. To check, press `Win+R`, type `winver`, and press Enter. Hiding the panel from screen capture needs a Windows feature added in version 2004.
- About **1 GB** of free disk space: the app, the speech model and the notes search model.
- A microphone. Headphones are best: with speakers, your mic also picks up the other side.
- For AI answers, an **Anthropic** or **Groq** API key. See [API keys](api-keys.md). You can add one later.

You don't need admin rights, Node.js, Python or a graphics card.

## 1. Download

Go to the [latest release](https://github.com/minhajuddinm/glimpse/releases/latest). Under **Assets**, download **`Glimpse.Setup.x.y.z.exe`** (about 320 MB). The speech and search models are included, so nothing more is downloaded on first run.

## 2. Run the installer

1. Double-click the downloaded file.
2. <a id="windows-protected-your-pc"></a>**"Windows protected your PC"**: click **More info**, then **Run anyway**. Windows shows this for any app that isn't code-signed. Code signing costs money every year, and this is a free open-source project. If you'd rather check the code first, you can [build the installer yourself](building.md).
3. Choose **Only for me** (no admin needed) and pick a folder, or keep the default (`C:\Users\<you>\AppData\Local\Programs\Glimpse`).
4. Click **Install**, then **Finish**.

## 3. First launch

Glimpse starts in the **system tray**, the icons at the bottom-right of the taskbar; click **^** if you don't see it. The Settings window also opens. You can come back to it any time by clicking the tray icon.

Next:
1. **Answers** tab: paste an API key ([how to get one](api-keys.md)).
2. **Notes** tab: add your notes ([what to put there](notes.md)).
3. **Audio** tab: check that both meters move. **Them** moves when you play a video, and **You** moves when you speak.
4. Press **`Ctrl+Alt+G`** to show the panel on the right of your screen.
5. **Capture test** tab: run the self-test. It should say **PASS** ([more](overlay.md#check-that-it-really-is-invisible)).

The first time Glimpse uses the microphone, Windows may ask for permission. You can also allow it under **Settings → Privacy & security → Microphone → Let desktop apps access your microphone**.

## Where your data lives

Your settings, encrypted keys, meeting transcripts and notes index live **outside** the install folder, so updating or uninstalling never deletes them.

| Installed on | Settings and data | Default notes folder |
|---|---|---|
| The Windows drive (usually C:) | `%APPDATA%\Glimpse` | `Documents\Glimpse Notes` |
| Another drive, e.g. `D:\Apps\Glimpse` | `D:\Apps\Glimpse Data` | `D:\Apps\Glimpse Notes` |

On another drive, the data folders sit **next to** the install folder, so Windows needs to let you create folders there. Some drives have locked-down top-level folders: if Glimpse won't start after installing to one, pick a folder you own, such as one under `D:\Users\<you>` or a new top-level folder you create yourself.

You can point Glimpse at any notes folder in **Notes → Change folder…**.

## Updating

Download the new installer and run it over the old one. Your settings, keys, notes and meetings are kept. Quit Glimpse from the tray first (**right-click the tray icon → Quit Glimpse**).

## Uninstalling

Use **Settings → Apps → Installed apps → Glimpse → Uninstall** in Windows, or run `Uninstall Glimpse.exe` in the install folder. Your data folders from the table above are kept; delete them yourself if you want everything gone.

## Start with Windows

Turn on **General → Launch at login** to start Glimpse in the tray when you sign in.
