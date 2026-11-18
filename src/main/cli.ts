export interface CliOptions {
  /** Run the capture self-test without a UI, print the result and exit (0 = PASS). */
  readonly selfTest: boolean
  /** Paint the canary on the protected overlay for this many seconds so an external recorder can be checked. */
  readonly canarySeconds: number | null
}

export function parseCli(argv: readonly string[]): CliOptions {
  let canarySeconds: number | null = null
  for (const arg of argv) {
    const match = /^--canary=(\d{1,4})$/.exec(arg)
    if (match?.[1] !== undefined) canarySeconds = Number(match[1])
  }
  return { selfTest: argv.includes('--selftest'), canarySeconds }
}

export function isHeadless(options: CliOptions): boolean {
  return options.selfTest || options.canarySeconds !== null
}
