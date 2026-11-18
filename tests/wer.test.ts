import { describe, expect, it } from 'vitest'
import { normalizeForWer, numberToWords, wordErrors } from '../src/shared/wer'

describe('numberToWords', () => {
  it.each([
    [0, 'zero'],
    [13, 'thirteen'],
    [23, 'twenty three'],
    [90, 'ninety'],
    [100, 'one hundred'],
    [305, 'three hundred five'],
    [10_000, 'ten thousand'],
    [45_000, 'forty five thousand'],
    [1_250_000, 'one million two hundred fifty thousand']
  ])('%i → %s', (value, words) => {
    expect(numberToWords(value)).toBe(words)
  })
})

describe('normalizeForWer', () => {
  it('treats spelled and formatted numbers as the same', () => {
    expect(normalizeForWer('a budget of $45,000 for the quarter')).toEqual(
      normalizeForWer('a budget of forty five thousand dollars for the quarter')
    )
    expect(normalizeForWer('revenue grew by 23%')).toEqual(normalizeForWer('revenue grew by twenty three percent'))
    expect(normalizeForWer('ten thousand requests')).toEqual(normalizeForWer('10 000 requests'))
    expect(normalizeForWer('it was twenty-three')).toEqual(['it', 'was', 'twenty', 'three'])
  })

  it('joins spelled-out acronyms', () => {
    expect(normalizeForWer('an a p i for the p m')).toEqual(['an', 'api', 'for', 'the', 'pm'])
    expect(normalizeForWer('an api for the pm')).toEqual(['an', 'api', 'for', 'the', 'pm'])
  })

  it('keeps a lone article and apostrophes', () => {
    expect(normalizeForWer('a process, and a thread. Don’t panic')).toEqual(['a', 'process', 'and', 'a', 'thread', 'don', 't', 'panic'])
    expect(normalizeForWer("it's a test")).toEqual(["it's", 'a', 'test'])
  })

  it('unifies compound spellings', () => {
    expect(normalizeForWer('hashmap')).toEqual(['hash', 'map'])
    expect(normalizeForWer('twenty per cent')).toEqual(['twenty', 'percent'])
  })

  it('returns nothing for empty or punctuation-only text', () => {
    expect(normalizeForWer('')).toEqual([])
    expect(normalizeForWer(' ?! ')).toEqual([])
  })
})

describe('wordErrors', () => {
  it('counts substitutions, insertions and deletions', () => {
    expect(wordErrors(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0)
    expect(wordErrors(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1)
    expect(wordErrors(['a', 'b', 'c'], ['a', 'c'])).toBe(1)
    expect(wordErrors(['a', 'c'], ['a', 'b', 'c'])).toBe(1)
    expect(wordErrors(['a', 'b'], [])).toBe(2)
    expect(wordErrors([], ['a'])).toBe(1)
  })
})
