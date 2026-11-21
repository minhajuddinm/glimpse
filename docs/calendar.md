# Calendar

Connecting a calendar gives you:
- **Briefs:** 5 minutes before a meeting with other people or a call link, the overlay shows who you're meeting and what to prepare. The brief comes from the invite and your notes.
- **Titles:** recordings are named after the calendar meeting happening at the time.
- **The day ahead:** the next 24 hours are listed in **Meetings → Calendar**, each with **Brief** and **Record** buttons.

Access is **read-only**: Glimpse never changes your calendar. It re-reads the calendar every 5 minutes; press **Refresh** to update now.

There are two ways to connect:

| | Secret iCal address | Sign in with Google |
|---|---|---|
| Works with | Google, Outlook, iCloud and anything else that offers an `.ics` link | Google Calendar, including school and work accounts |
| Setup | Copy and paste one link (1 minute) | One-time Google Cloud setup (about 5 minutes, free) |
| Skips meetings you declined | No | Yes |
| Use it when | Your calendar offers a secret address | Your account doesn't have one (often school or work accounts) |

## Option A: secret iCal address (easiest)

**Google Calendar**
1. Go to [calendar.google.com](https://calendar.google.com) **on a computer**; the phone app doesn't have this setting.
2. Click ⚙ **→ Settings**.
3. In the left sidebar, under **Settings for my calendars**, click your calendar.
4. Click **Integrate calendar**.
5. Copy **Secret address in iCal format**: click the eye icon, then copy. It contains `/private-`.
   - Don't copy the **Public address** just above it. It only works if your calendar is public, and otherwise Glimpse reports "address not found".
   - **No secret address?** Your organisation has turned it off. Use option B.

**Outlook (outlook.com or Microsoft 365)**
1. Go to Outlook on the web, then **Settings → Calendar → Shared calendars**.
2. Under **Publish a calendar**, choose your calendar and **Can view all details**, then click **Publish**.
3. Copy the **ICS** link.

**iCloud:** in the Calendar app, share the calendar as a **Public Calendar** and copy the link (`webcal://…`).

**In Glimpse:** go to **Meetings → Calendar → Or use a secret iCal address**, paste the link, and click **Connect**.

Treat the link like a password: anyone who has it can read your calendar. Glimpse stores it encrypted. If it ever leaks, reset it in your calendar's settings.

## Option B: Sign in with Google

Glimpse is a free open-source app, not a Google-verified one. Each person therefore creates their own free sign-in key ("OAuth client") in Google Cloud, once. You can do this with any Google account, for example your personal Gmail, even if the calendar is on a school account.

### 1. Create the Google Cloud project
1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and accept the terms if asked.
2. Click the project picker at the top, then **New project**. Name it `Glimpse` and click **Create**, then make sure it is selected.

### 2. Turn on the Calendar API
1. Go to **☰ → APIs & Services → Library**.
2. Search **Google Calendar API**, open it, and click **Enable**.

### 3. Set up the sign-in screen
1. Go to **☰ → Google Auth Platform**, or search for "OAuth consent screen", and click **Get started**.
2. Fill in:
   - **App name:** Glimpse
   - **User support email:** your email
   - **Audience:** **External**, or **Internal** if it's offered, which happens when your Cloud account belongs to a Google Workspace organisation.
   - **Contact email:** your email
3. Agree to the policy and click **Create**.

### 4. Publish the app (or add yourself as a test user)
New apps start in **Testing**, and Google signs Testing apps out every **7 days**. To avoid that:
1. Go to **Audience** and click **Publish app**, then **Confirm**.
   - **"Publish app" is greyed out?** Open **Branding**, fill in every required field, and click **Save**. Then try again.
   - **Branding asks for a home page, privacy policy or authorised domain** that you don't have? Skip publishing. Instead, on **Audience → Test users**, click **+ Add users** and add the Google account whose calendar you want. When the 7 days run out, click **Disconnect** and **Sign in with Google** again in Glimpse, which takes two clicks.
2. If you chose **Internal**, there's nothing to publish and no 7-day limit.

### 5. Create the client
1. Go to **Clients → Create client**.
2. For **Application type**, choose **Desktop app**. The name can be anything. Click **Create**.
3. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`) and the **Client secret** (it starts with `GOCSPX-`). You can come back here to view them again.

### 6. Sign in from Glimpse
1. Go to **Meetings → Calendar**, paste the Client ID and Client secret, and click **Sign in with Google**.
2. Your browser opens Google's sign-in page. Choose the account whose calendar you want.
3. Google says **"Google hasn't verified this app"**. That's expected, because it's your own project. Click **Advanced → Go to Glimpse (unsafe)**.
4. Allow **"See events on all your calendars"**. That's read-only access. Click **Continue**.
5. The tab says **"Glimpse is connected"**. Back in Glimpse, the card shows **Connected to Google Calendar** and your next 24 hours.

Glimpse asks only for the `calendar.events.readonly` permission. The client secret and the sign-in token are stored encrypted. **Disconnect** signs out and tells Google to revoke access; the client stays saved, so signing in again needs no retyping.

### If something goes wrong

| What you see | What to do |
|---|---|
| **"Access blocked: … has not approved this app"** or **"admin_policy_enforced"** | Your school or company blocks apps it hasn't approved. Only its IT team can allow it. Try option A, or a personal calendar. |
| **"Error 400: redirect_uri_mismatch"** or **"invalid_client"** | The client type isn't **Desktop app**, or the ID or secret was copied wrongly. Create a new **Desktop app** client and paste it again. |
| **"Access blocked: Glimpse has not completed the Google verification process"** | The app is in **Testing** and this account isn't a test user. Add it under **Audience → Test users**, or publish the app. |
| **"The Google Calendar API is off in your Google Cloud project"** | Do step 2, then press **Refresh**. |
| **"Your Google sign-in has expired or was revoked"** | Click **Disconnect**, then **Sign in with Google**. This happens every 7 days while the app is in Testing. |
| **"Google sign-in did not finish"** | The browser tab was closed or Google showed an error. Try again and read the message on Google's page. |
