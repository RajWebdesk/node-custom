import type { Actor } from "./roles.js";

// Planned time allocation rules (spec Module 8, Task #8.1). Pure functions, no I/O.
// Allocated time is planned time, not time worked. Only the Administrator changes it (roles.ts).
// Reason is optional: the spec leaves it non-mandatory (confirmed 2026-10-19).

export const ADJUST_MODES = ["set", "increase", "decrease"] as const;
export type AdjustMode = (typeof ADJUST_MODES)[number];

// Column type is Decimal(6, 2): at most 9999.99 and two decimal places.
export const MAX_PLANNED_HOURS = 9999.99;

export type AdjustResult =
  | { ok: true; previousHours: number; newHours: number; delta: number }
  | { ok: false; reason: "invalid-hours" | "negative-result" | "too-large" | "no-change" };

export function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

// Two decimal places at most, and a positive amount for increase and decrease.
export function isValidHours(value: number, mode: AdjustMode): boolean {
  if (!Number.isFinite(value)) return false;
  if (Math.round(value * 100) !== value * 100) return false;
  return mode === "set" ? value >= 0 : value > 0;
}

export function computeAdjustment(current: number, mode: AdjustMode, hours: number): AdjustResult {
  if (!isValidHours(hours, mode)) return { ok: false, reason: "invalid-hours" };
  const next =
    mode === "set" ? hours : mode === "increase" ? roundHours(current + hours) : roundHours(current - hours);
  if (next < 0) return { ok: false, reason: "negative-result" };
  if (next > MAX_PLANNED_HOURS) return { ok: false, reason: "too-large" };
  if (next === current) return { ok: false, reason: "no-change" };
  return { ok: true, previousHours: current, newHours: next, delta: roundHours(next - current) };
}

// Administrators see every allocation. Managers see every allocation too (role matrix: Time, View).
// Employees see only their own.
export function canViewAllocation(actor: Actor, subjectId: string): boolean {
  return actor.roles.includes("ADMINISTRATOR") || actor.roles.includes("MANAGER") || actor.id === subjectId;
}
