# API keys

Glimpse uses an AI model to turn your notes and the conversation into short answers, and to write meeting minutes. It has **no server and no account**: you bring your own key, and requests go straight from your PC to that provider.

| | Anthropic (Claude) | Groq |
|---|---|---|
| Best for | Accurate answers that stick to your notes | Trying Glimpse for free |
| Cost | Pay as you go: about **$0.04 per hour** of calls, minutes about $0.05 per hour of meeting | **Free** tier |
| Limits | Plenty for normal use | About 2–4 answers a minute; slower at busy times |
| Quality | Follows your notes closely and rarely makes things up | Fast, but may invent personal details unless your notes cover them |

You can save both. With **Use: Auto**, Glimpse picks Claude when its key is saved and Groq otherwise.

Without any key, Glimpse still transcribes, and prepared answers from your notes still appear. You just don't get AI-written answers or minutes.

## Anthropic (recommended)

1. Go to **[console.anthropic.com](https://console.anthropic.com)** and sign up. This account is separate from a claude.ai chat subscription.
2. Add credit under **Settings → Billing**. The smallest top-up is enough for many hours of calls. You can also set a monthly spend limit there.
3. Go to **Settings → API Keys → Create Key**, name it "Glimpse", and copy it. It starts with `sk-ant-api03-`, and Anthropic shows it only once.
4. In Glimpse, go to **Answers → AI provider → Anthropic · Claude**, paste the key, and click **Save**.
5. Test it under **Answers → Try it**: type a question and click **Ask**.

Glimpse uses **Claude Haiku 5.5** for live answers (fast and cheap) and **Claude Sonnet 5.5** for "elaborate" and meeting minutes.

## Groq (free)

1. Go to **[console.groq.com](https://console.groq.com)** and sign in with Google or GitHub, or with an email address.
2. Go to **API Keys → Create API Key**, name it "Glimpse", and copy it. It starts with `gsk_`.
3. In Glimpse, go to **Answers → AI provider → Groq · free tier**, paste the key, and click **Save**.

Groq runs the open `gpt-oss-120b` model. On the free tier, long meetings are summarised in parts, and the minutes take a little longer.

## Keeping keys safe

- Glimpse encrypts keys with Windows (DPAPI) before saving them. Only your Windows account can decrypt them, and they're never shown again or sent anywhere except to the provider.
- **Never paste a key into a chat, an email or a GitHub issue.** If one leaks, delete it on the provider's API Keys page and create a new one.
- To remove a key from Glimpse, click **Remove** next to it on the **Answers** page.

## What gets sent

For each answer, Glimpse sends the last few minutes of transcript, the matching passages from your notes, and your **About you** text. For minutes, it sends that meeting's transcript. Audio is never sent. See [Privacy](privacy.md).
