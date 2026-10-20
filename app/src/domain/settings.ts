import { APP_TIMEZONE, REMINDER_SLOT_HOUR } from "./schedule.js";

// Settings view (spec Module 13, Task #13.4). The values here are the approved decisions, not editable settings:
// the spec defines no editable settings beyond roles, and there is no custom permission builder.
// Changing any of them needs a new decision and a release.

export const SESSION_MINUTES = 60; // D1 sessions, server-side, expiry 60 minutes (technical default, see decision D1)
export const RESET_TOKEN_MINUTES = 60; // administrator-assisted reset expiry (technical default, Task #4.3)
export const PASSWORD_MIN_LENGTH = 12; // Argon2id accounts, minimum length

// Role-by-module matrix from the sow-spec role rules. Same wording as the Roles page.
export const PERMISSION_MATRIX = [
  { module: "Tasks", Administrator: "View, Create, Edit", Manager: "View, Create, Edit", Employee: "View (own tasks only)" },
  { module: "Reviews", Administrator: "View", Manager: "View; Approve (designated reviewer only)", Employee: "View (own submissions)" },
  { module: "Time", Administrator: "View, Edit", Manager: "View", Employee: "View (own allocation)" },
  { module: "Users", Administrator: "View, Create, Edit", Manager: "View (assignable users)", Employee: "None" },
  { module: "Reports", Administrator: "View (all)", Manager: "View (all)", Employee: "View (own)" },
  { module: "Activity log", Administrator: "View", Manager: "None", Employee: "None" },
] as const;

export const ROLE_LABELS = { ADMINISTRATOR: "Administrator", MANAGER: "Manager", EMPLOYEE: "Employee" } as const;

// What the settings screen may say about email: never the provider setting itself.
export function emailMode(env: NodeJS.ProcessEnv): "pilot-suppressed" | "provider-not-integrated" {
  return env.EMAIL_PROVIDER ? "provider-not-integrated" : "pilot-suppressed";
}

export function systemSettings(env: NodeJS.ProcessEnv) {
  return {
    timezone: APP_TIMEZONE,
    reminderSlot: `${String(REMINDER_SLOT_HOUR).padStart(2, "0")}:00`,
    sessionMinutes: SESSION_MINUTES,
    resetTokenMinutes: RESET_TOKEN_MINUTES,
    passwordMinLength: PASSWORD_MIN_LENGTH,
    emailMode: emailMode(env),
    editable: false as const,
  };
}
