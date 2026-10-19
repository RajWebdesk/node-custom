import { z } from "zod";

// Startup configuration validation. Names match g3/.env.example.
// Values are never logged. Invalid config must stop the process before serving.

// Intl.DateTimeFormat also accepts legacy aliases such as "EST", so check the canonical list.
const canonicalTimezones = new Set(Intl.supportedValuesOf("timeZone"));
const ianaTimezone = z
  .string()
  .refine((tz) => canonicalTimezones.has(tz), "must be a canonical IANA timezone");

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_TIMEZONE: ianaTimezone,
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  PASSWORD_HASH_ALGORITHM: z.literal("argon2id"),
  REMINDER_SLOT_LOCAL_TIME: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM"),
});

export type AppConfig = z.infer<typeof envSchema>;

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; errors: string[] };

export function loadConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const parsed = envSchema.safeParse(env);
  if (parsed.success) {
    return { ok: true, config: parsed.data };
  }
  // Report field names and rules only, never the submitted values.
  const errors = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { ok: false, errors };
}
