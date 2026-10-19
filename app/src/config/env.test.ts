import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

const valid = {
  NODE_ENV: "test",
  APP_TIMEZONE: "America/Toronto",
  DATABASE_URL: "postgres://localhost:5432/app",
  SESSION_SECRET: "0123456789abcdef0123",
  PASSWORD_HASH_ALGORITHM: "argon2id",
  REMINDER_SLOT_LOCAL_TIME: "09:00",
};

describe("loadConfig", () => {
  it("accepts a complete valid environment", () => {
    const result = loadConfig(valid);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-IANA timezone", () => {
    const result = loadConfig({ ...valid, APP_TIMEZONE: "EST" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("APP_TIMEZONE");
  });

  it("rejects a password hash algorithm other than argon2id", () => {
    const result = loadConfig({ ...valid, PASSWORD_HASH_ALGORITHM: "bcrypt" });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing required variable", () => {
    const { DATABASE_URL: _omit, ...rest } = valid;
    const result = loadConfig(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("DATABASE_URL");
  });

  it("never echoes submitted secret values in errors", () => {
    const result = loadConfig({ ...valid, SESSION_SECRET: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).not.toContain("short");
  });

  it("rejects a malformed reminder time", () => {
    const result = loadConfig({ ...valid, REMINDER_SLOT_LOCAL_TIME: "9am" });
    expect(result.ok).toBe(false);
  });
});
