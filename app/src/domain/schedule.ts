// Calendar and schedule helpers (spec: timezone America/Toronto drives the reminder job and report boundaries).
// Pure functions. Due dates are calendar dates stored as UTC midnight, so "date" comparisons are string comparisons
// on YYYY-MM-DD.

export const APP_TIMEZONE = "America/Toronto";
export const REMINDER_SLOT_HOUR = 9;

export interface LocalParts {
  date: string; // YYYY-MM-DD in APP_TIMEZONE
  hour: number; // 0 to 23 in APP_TIMEZONE
}

export function localParts(now: Date, timeZone: string = APP_TIMEZONE): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

// The calendar date one day after the given YYYY-MM-DD date.
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// A task is "due soon" when it is due today or tomorrow (within 24 hours of the slot), and "overdue" when due before today.
export function dueStatus(dueDate: string | null, today: string): "none" | "overdue" | "soon" | "later" {
  if (!dueDate) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate <= nextDay(today)) return "soon";
  return "later";
}
