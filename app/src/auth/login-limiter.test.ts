import { describe, expect, it } from "vitest";
import { LoginLimiter } from "./login-limiter.js";

// Fake clock so the 15-minute window can be tested without waiting.
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("login limiter (pilot decision: 5 failures per account and per IP in 15 minutes)", () => {
  it("allows attempts until the limit is reached, then blocks", () => {
    const c = clock();
    const limiter = new LoginLimiter({ maxFailures: 5, windowMs: 15 * 60_000, now: c.now });
    const keys = LoginLimiter.keysFor("a@example.test", "1.2.3.4");
    for (let i = 0; i < 4; i++) {
      expect(limiter.retryAfterSeconds(keys)).toBe(0);
      limiter.recordFailure(keys);
    }
    expect(limiter.retryAfterSeconds(keys)).toBe(0);
    limiter.recordFailure(keys);
    expect(limiter.retryAfterSeconds(keys)).toBeGreaterThan(0);
  });

  it("reports the wait until the oldest failure leaves the window", () => {
    const c = clock();
    const limiter = new LoginLimiter({ maxFailures: 2, windowMs: 60_000, now: c.now });
    const keys = ["account:x"];
    limiter.recordFailure(keys);
    c.advance(20_000);
    limiter.recordFailure(keys);
    c.advance(10_000); // 30 s after the first failure, 10 s after the second
    expect(limiter.retryAfterSeconds(keys)).toBe(30);
  });

  it("frees the attempt once the window has passed", () => {
    const c = clock();
    const limiter = new LoginLimiter({ maxFailures: 2, windowMs: 60_000, now: c.now });
    const keys = ["account:x"];
    limiter.recordFailure(keys);
    limiter.recordFailure(keys);
    expect(limiter.retryAfterSeconds(keys)).toBeGreaterThan(0);
    c.advance(60_001);
    expect(limiter.retryAfterSeconds(keys)).toBe(0);
  });

  it("a successful sign-in clears the account's failures but not the IP's", () => {
    const c = clock();
    const limiter = new LoginLimiter({ maxFailures: 2, windowMs: 60_000, now: c.now });
    const keys = LoginLimiter.keysFor("a@example.test", "9.9.9.9");
    limiter.recordFailure(keys);
    limiter.recordFailure(keys);
    limiter.reset(keys[0]);
    // The account is free again, but the IP still has two failures.
    expect(limiter.retryAfterSeconds([keys[0]])).toBe(0);
    expect(limiter.retryAfterSeconds([keys[1]])).toBeGreaterThan(0);
  });

  it("keeps account and IP counts separate", () => {
    const limiter = new LoginLimiter({ maxFailures: 1, windowMs: 60_000 });
    limiter.recordFailure(LoginLimiter.keysFor("a@example.test", "1.1.1.1"));
    expect(limiter.retryAfterSeconds(LoginLimiter.keysFor("b@example.test", "2.2.2.2"))).toBe(0);
  });
});
