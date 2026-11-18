/** Exponential backoff with jitter: 0.5×–1× of min(max, base·2^attempt). */
export function backoffDelay(attempt: number, random: () => number = Math.random, baseMs = 500, maxMs = 15_000): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  return Math.round(ceiling * (0.5 + random() / 2))
}

/** Opens after `limit` consecutive failures; any success closes it again. */
export class CircuitBreaker {
  private failures = 0

  constructor(private readonly limit = 5) {}

  get consecutiveFailures(): number {
    return this.failures
  }

  get open(): boolean {
    return this.failures >= this.limit
  }

  recordFailure(): void {
    this.failures++
  }

  recordSuccess(): void {
    this.failures = 0
  }

  reset(): void {
    this.failures = 0
  }
}
