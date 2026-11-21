# Your notes folder

Glimpse searches your notes **before** it asks the AI. When a question matches something you've prepared, it shows your answer instantly, marked *from your notes*, and the AI then adapts it to the exact question. This is what makes answers sound like you, with your real projects and numbers, instead of generic advice.

## Adding notes

Open the **Notes** tab:
- **Add files…** copies files into your notes folder.
- **Open notes folder** opens it in File Explorer, where you can create, edit or delete files.
- **Change folder…** points Glimpse at any folder you already use, such as a Dropbox or OneDrive folder. **Use default** switches back.

Glimpse watches the folder, so changes are picked up within seconds. The card shows how many **files**, **prepared answers** and **searchable passages** it found, and lists any file it couldn't read.

Supported files: **`.md` `.txt` `.docx` `.pdf` `.json` `.csv`**. A PDF must contain real text: a scanned image of a page can't be searched.

## What to put in it

| For | Good notes |
|---|---|
| Job interviews | Resume; the job description; prepared answers to common questions; STAR stories with numbers; questions to ask them |
| Sales calls | Pricing, plans and discounts; competitor comparisons; answers to common objections; case studies |
| Technical interviews | Your projects' architecture, trade-offs and metrics; topics you revised |
| Meetings | Glimpse saves each meeting's minutes in `Meetings/` in this folder, so later answers can draw on them |

Also fill in **Answers → About you** with a short summary: who you are, the role, and your goals. It's included in every answer.

## Writing prepared answers

Write questions and answers in either of these two forms. Glimpse stores each pair as one unit and matches the question even when it's worded differently.

**Q:/A: lines**

```markdown
Q: Tell me about yourself.
A: I'm a final-year software engineering student. Last summer I interned at Acme on the payments team,
where I cut checkout latency by 30% by moving fraud checks to an async queue...

Q: Why do you want to work here?
A: ...
```

**A heading ending in a question mark**

```markdown
## What is your biggest weakness?
I used to over-polish before sharing work. Now I share a rough version by day two and ask for feedback...

## Describe a time you handled conflict?
...
```

Also supported:
- **CSV** with `question,answer` columns.
- **JSON** as a list of `{ "question": "...", "answer": "..." }`.

Other text (resume bullets, project write-ups, pricing tables) is split into passages and searched too. It just isn't shown as an instant answer.

### Tips

- **One question per heading or `Q:`.** Put the wording you expect them to use; Glimpse handles rewording.
- **Lead with the answer.** The panel shows short answers (about 55 words), so put the key point and the number first.
- **Use your real details.** Glimpse is told never to invent experience that isn't in your notes or **About you**, so the more you write, the better the answers.
- Several files are fine. Glimpse shows which file an answer came from.

## Test a search

The **Notes → Test a search** box shows what Glimpse would find for any question, and how closely it matches. Use it to check that your prepared answers come up.

## Privacy

Your notes are indexed **on your PC**, using a small local search model. Only the few passages that match a question are sent to your AI provider with that question. See [Privacy](privacy.md).
