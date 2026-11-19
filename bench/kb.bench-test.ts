/**
 * Gate G11 calibration: 10 prepared answers, 5 questions asked in different words,
 * 3 unrelated questions. Uses the real embedding model. Run: npm run bench:kb
 */
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { chunkDocument } from '../src/main/kb/chunk'
import { loadEmbedder } from '../src/main/kb/embedder'
import { INSTANT_SIMILARITY, KbStore, hybridSearch, instantAnswer, type IndexedChunk } from '../src/main/kb/store'

const NOTES = `
Q: Tell me about yourself
A: I'm a final-year software engineering student who builds developer tools; I interned at Shopify on payments.

Q: What is your biggest weakness?
A: I over-polish details, so I now time-box polishing and ship earlier.

Q: Why do you want to work here?
A: Your team builds the developer tools I use every day, and I want to work on them.

Q: Tell me about a project you are proud of
A: I built Glimpse, a real-time meeting copilot with local speech recognition.

Q: Describe a time you disagreed with your manager
A: I disagreed about skipping tests before a launch; I showed the risk with data and we added a smoke test.

Q: Where do you see yourself in five years?
A: Leading a small platform team and mentoring new engineers.

Q: How do you handle tight deadlines?
A: I cut scope early, agree on what "done" means, and communicate risks the same day.

Q: What are your salary expectations?
A: Around the market range for this role in Toronto, and I am flexible for the right team.

Q: Tell me about a time you failed
A: My first hackathon demo crashed; since then I always rehearse on the real hardware.

Q: Why are you leaving your current job?
A: I want to work on products at a larger scale than my current role allows.
`

const PARAPHRASES: [string, string][] = [
  ['Could you introduce yourself briefly', 'Tell me about yourself'],
  ['What would you say you need to improve on', 'What is your biggest weakness?'],
  ['What attracts you to our company', 'Why do you want to work here?'],
  ["What's an achievement you're really proud of", 'Tell me about a project you are proud of'],
  ['Have you ever had a conflict with your boss and how did you handle it', 'Describe a time you disagreed with your manager']
]
const OFF_TOPIC = ['What is the time complexity of binary search', 'Explain how a hash map handles collisions', "What's the weather like there today"]

it('G11: reworded questions find their prepared answer; unrelated ones do not', async () => {
  const embedder = await loadEmbedder(join(import.meta.dirname, '..', 'models'))
  expect(embedder, 'run: npm run fetch-models -- --only bge-small-en').not.toBeNull()
  if (embedder === null) return
  const store = new KbStore(openDatabase(':memory:'))
  const chunks = chunkDocument(NOTES)
  const vectors = await embedder.embed(chunks.map((chunk) => `${chunk.question ?? ''}\n${chunk.text}`))
  const questionVectors = await embedder.embed(chunks.map((chunk) => chunk.question ?? chunk.text))
  const indexed: IndexedChunk[] = chunks.map((chunk, i) => ({ ...chunk, vec: vectors[i] ?? null, qvec: questionVectors[i] ?? null }))
  store.replaceFile('interview.md', 'h', indexed, null)

  let hits1 = 0
  let instant = 0
  for (const [asked, expected] of PARAPHRASES) {
    const started = performance.now()
    const vec = (await embedder.embed([asked]))[0] ?? null
    const hits = hybridSearch(store, asked, vec)
    const ms = performance.now() - started
    const top = hits[0]
    if (top?.question !== expected) {
      const sem = vec === null ? [] : store.semantic(vec, 3).map((h) => `${(store.chunk(h.id)?.question ?? "?").slice(0, 40)} ${h.similarity.toFixed(3)}`)
      const kw = store.keyword(asked, 3).map((id) => (store.chunk(id)?.question ?? "?").slice(0, 40))
      console.log(`    semantic top3: ${sem.join(" | ")}
    keyword top3: ${kw.join(" | ")}`)
    }
    if (top?.question === expected) hits1++
    if (instantAnswer(hits)?.question === expected) instant++
    console.log(`  ${top?.question === expected ? 'HIT ' : 'MISS'} sim=${top?.similarity?.toFixed(3) ?? '-'} ${ms.toFixed(0)}ms  "${asked}" → "${top?.question ?? '-'}"`)
  }
  let falseInstant = 0
  let offCited = 0
  for (const asked of OFF_TOPIC) {
    const vec = (await embedder.embed([asked]))[0] ?? null
    const hits = hybridSearch(store, asked, vec)
    if (instantAnswer(hits) !== null) falseInstant++
    if (hits.length > 0) offCited++
    console.log(`  OFF  sim=${hits[0]?.similarity?.toFixed(3) ?? '-'}  "${asked}" → "${hits[0]?.question ?? '-'}"`)
  }
  console.log(`G11 hit@1 ${hits1}/${PARAPHRASES.length}, instant ${instant}/${PARAPHRASES.length}, false instant ${falseInstant}/${OFF_TOPIC.length} (threshold ${INSTANT_SIMILARITY}), unrelated citing notes ${offCited}/${OFF_TOPIC.length}`)
  expect(hits1).toBe(PARAPHRASES.length)
  expect(falseInstant).toBe(0)
  expect(offCited).toBe(0)
}, 120_000)
