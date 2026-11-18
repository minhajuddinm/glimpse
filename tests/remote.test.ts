import { describe, expect, it } from 'vitest'
import { matchViewers, parseTasklist } from '../src/main/remote'

const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"parsecd.exe","28968","Console","1","61,244 K"',
  '"Sunshine.exe","15672","Console","1","40,100 K"',
  '"parsecd.exe","30088","Console","1","12,000 K"',
  '"chrome.exe","12732","Console","1","310,000 K"',
  ''
].join('\r\n')

describe('parseTasklist', () => {
  it('lower-cases image names and skips blank lines', () => {
    expect(parseTasklist(TASKLIST)).toEqual(['system idle process', 'parsecd.exe', 'sunshine.exe', 'parsecd.exe', 'chrome.exe'])
  })

  it('returns nothing for empty or malformed output', () => {
    expect(parseTasklist('')).toEqual([])
    expect(parseTasklist('INFO: No tasks are running.')).toEqual([])
  })
})

describe('matchViewers', () => {
  it('names each remote-viewing tool once, sorted', () => {
    expect(matchViewers(parseTasklist(TASKLIST))).toEqual(['Parsec', 'Sunshine (Moonlight host)'])
  })

  it('finds nothing among ordinary apps', () => {
    expect(matchViewers(['chrome.exe', 'code.exe', 'electron.exe'])).toEqual([])
  })
})
