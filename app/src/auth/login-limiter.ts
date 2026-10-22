// Sign-in failure limit (pilot decision, 2026-10-21): five failed attempts per account and per IP within 15 minutes.
// A blocked attempt is refused before the password is checked. Successful sign-in clears the account's failures.
// Held in memory, so a restart of the API clears the counters. Acceptable for the single-process local pilot only.

export interface LoginLimiterOptions {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
}

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;

export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly options: LoginLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  // The keys an attempt is counted against. Email is lower-cased by the caller.
  static keysFor(email: string, ip: string): string[] {
    return [`account:${email}`, `ip:${ip}`];
  }

  // Seconds until the next attempt is allowed, or 0 when the attempt may proceed.
  retryAfterSeconds(keys: string[]): number {
    const now = this.now();
    let wait = 0;
    for (const key of keys) {
      const recent = this.recent(key, now);
      if (recent.length >= this.options.maxFailures) {
        // The attempt is refused until the oldest failure in the window ages out.
        const freeAt = recent[recent.length - this.options.maxFailures] + this.options.windowMs;
        wait = Math.max(wait, Math.ceil((freeAt - now) / 1000));
      }
    }
    return wait;
  }

  recordFailure(keys: string[]): void {
    const now = this.now();
    for (const key of keys) {
      const list = this.recent(key, now);
      list.push(now);
      this.failures.set(key, list);
    }
  }

  // Clears the account's failures only; the IP keeps its count until the window passes.
  reset(accountKey: string): void {
    this.failures.delete(accountKey);
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((t) => now - t < this.options.windowMs);
    if (kept.length === 0) this.failures.delete(key);
    return kept;
  }
}
