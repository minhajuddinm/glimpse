export interface CliOptions {
  /** Run the capture self-test without a UI, print the result and exit (0 = PASS). */
  readonly selfTest: boolean
  /** Paint the canary on the protected overlay for this many seconds so an external recorder can be checked. */
  readonly canarySeconds: number | null
  /** Run real questions through the answer pipeline with the saved keys and print timings (G7). */
  readonly answerBench: boolean
  /** Write minutes for a scripted sample call with the saved keys and print them. */
  readonly minutesBench: boolean
}

export function parseCli(argv: readonly string[]): CliOptions {
  let canarySeconds: number | null = null
  for (const arg of argv) {
    const match = /^--canary=(\d{1,4})$/.exec(arg)
    if (match?.[1] !== undefined) canarySeconds = Number(match[1])
  }
  return { selfTest: argv.includes('--selftest'), canarySeconds, answerBench: argv.includes('--answer-bench'),
    minutesBench: argv.includes('--minutes-bench')
  }
}

export function isHeadless(options: CliOptions): boolean {
  return options.selfTest || options.canarySeconds !== null
}
