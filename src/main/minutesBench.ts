import { join } from 'node:path'
import { app } from 'electron'
import type { Source } from '../shared/transcript'
import { anthropicProvider, groqProvider, type LlmProvider } from './answers/llm'
import { openDatabase } from './db'
import { MeetingManager } from './meetings/manager'
import { MINUTES_SECTIONS } from './meetings/minutes'
import { MeetingStore } from './meetings/store'
import { SecretStore } from './secrets'
import { SettingsStore } from './settingsStore'

/** A fictional sales call, as speech recognition would deliver it (lower case, small mis-hearings). */
const SCRIPT: readonly (readonly [Source, string])[] = [
  ['them', 'hi thanks for making time today so i am priya i run operations at northwind logistics'],
  ['you', 'great to meet you priya i am here to walk you through how our routing tool could fit your team'],
  ['them', 'sure so right now we plan about four hundred deliveries a day across three depots and it is mostly spreadsheets'],
  ['them', 'the big pain is when a driver calls in sick we lose an hour re planning routes'],
  ['you', 'that is exactly what the re plan button does it rebuilds the routes in under a minute and pushes them to the drivers phones'],
  ['them', 'okay and what does pricing look like for three depots'],
  ['you', 'for your size it would be about two thousand four hundred dollars a month on the annual plan including onboarding'],
  ['them', 'that is a bit above what we budgeted we were thinking closer to two thousand'],
  ['you', 'understood we could start with two depots for a three month pilot at one thousand six hundred a month and add the third after'],
  ['them', 'that could work i would need sign off from our cfo mark though he will want to see the security review'],
  ['you', 'no problem i will send you our soc two report and the security questionnaire by friday'],
  ['them', 'perfect and can it integrate with our warehouse system we use acme wms'],
  ['you', 'we have an acme integration in beta i will check with our product team whether it is ready for a pilot'],
  ['them', 'okay so if the security review goes well we could aim to start the pilot on the first of march'],
  ['you', 'sounds good i will also set up a demo with mark next week lets say tuesday at two'],
  ['them', 'tuesday at two works for me i will forward the invite to mark'],
  ['them', 'one more thing do you support french for our montreal drivers'],
  ['you', 'the driver app supports french yes the dispatcher dashboard is english only for now'],
  ['them', 'alright that is fine thanks this was helpful'],
  ['you', 'thank you priya talk on tuesday']
]

/**
 * `--minutes-bench`: writes minutes for the scripted call with each saved key and prints them
 * with timings. Uses a throwaway in-memory database, so nothing is added to the user's meetings.
 * Never prints keys.
 */
export async function runMinutesBench(): Promise<number> {
  const db = openDatabase(join(app.getPath('userData'), 'glimpse.db'))
  const settings = new SettingsStore(db)
  const secrets = new SecretStore(settings)
  await secrets.load()
  const providers: LlmProvider[] = []
  const anthropicKey = secrets.get('anthropic')
  const groqKey = secrets.get('groq')
  if (anthropicKey !== null) providers.push(anthropicProvider(anthropicKey))
  if (groqKey !== null) providers.push(groqProvider(groqKey))
  db.close()
  if (providers.length === 0) {
    console.log('NO_KEYS saved in Settings → Answers')
    return 2
  }

  let failed = false
  for (const provider of providers) {
    const store = new MeetingStore(openDatabase(':memory:'))
    let clock = Date.now()
    const manager = new MeetingManager({
      store,
      provider: () => provider,
      context: () => '',
      files: { write: () => Promise.resolve(null), remove: () => Promise.resolve() },
      now: () => clock,
      onState: () => undefined,
      onListChanged: () => undefined
    })
    const id = manager.start('Northwind Logistics – routing pilot').active?.id ?? -1
    for (const [index, [source, text]] of SCRIPT.entries()) {
      clock += 8000
      manager.onSegment({ id: index + 1, source, text, at: clock, latencyMs: null })
    }
    const started = Date.now()
    manager.stop()
    await manager.summarize(id)
    const detail = store.detail(id)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    const minutes = detail?.minutes ?? ''
    const missing = MINUTES_SECTIONS.filter((section) => !new RegExp(`^##\\s+${section}`, 'im').test(minutes))
    // Facts a correct set of minutes must carry over from the call.
    const facts = ['1,600|1600', 'march', 'friday', 'tuesday', 'mark', 'soc']
    const lost = facts.filter((fact) => !new RegExp(fact, 'i').test(minutes))
    const ok = detail?.status === 'done' && missing.length === 0 && lost.length === 0
    if (!ok) failed = true
    console.log(`\n=== ${provider.id} (${detail?.model ?? '?'}) — ${seconds}s — ${ok ? 'PASS' : 'FAIL'}`)
    if (detail?.error !== null && detail?.error !== undefined) console.log(`ERROR ${detail.error}`)
    if (missing.length > 0) console.log(`MISSING_SECTIONS ${missing.join(', ')}`)
    if (lost.length > 0) console.log(`MISSING_FACTS ${lost.join(', ')}`)
    console.log(minutes)
  }
  return failed ? 1 : 0
}
