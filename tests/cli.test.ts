import { describe, expect, it } from 'vitest'
import { isHeadless, parseCli } from '../src/main/cli'

describe('parseCli', () => {
  it('is a normal start with no flags', () => {
    const options = parseCli(['electron.exe', '.'])
    expect(options).toEqual({ selfTest: false, canarySeconds: null, answerBench: false, minutesBench: false })
    expect(isHeadless(options)).toBe(false)
  })

  it('recognises --selftest and --canary=N as headless', () => {
    expect(isHeadless(parseCli(['x', '--selftest']))).toBe(true)
    const canary = parseCli(['x', '--canary=45'])
    expect(canary.canarySeconds).toBe(45)
    expect(isHeadless(canary)).toBe(true)
  })

  it('ignores malformed canary durations', () => {
    expect(parseCli(['x', '--canary=abc']).canarySeconds).toBeNull()
    expect(parseCli(['x', '--canary=']).canarySeconds).toBeNull()
    expect(parseCli(['x', '--canary=123456']).canarySeconds).toBeNull()
  })
})
