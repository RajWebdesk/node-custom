import { dueStatus, nextDay } from "./schedule.js";

// Task reports (spec Module 13, Task #13.1). Pure functions over task records. Dates are calendar dates (YYYY-MM-DD).
// Due dates are stored as UTC midnight, so the calendar date is the first 10 characters of the ISO string.

export const GROUP_BY = ["status", "priority", "assignee", "overdue"] as const;
export type GroupBy = (typeof GROUP_BY)[number];
export const DATE_FIELDS = ["createdAt", "dueDate"] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export interface ReportTask {
  status: string;
  priority: string;
  assigneeId: string;
  createdAt: Date;
  dueDate: Date | null;
  archivedAt: Date | null;
}

export function calendarDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

// No range means no date filter, so tasks without that date still appear in the report.
export function inRange(task: ReportTask, field: DateField, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  const day = field === "createdAt" ? calendarDate(task.createdAt) : calendarDate(task.dueDate);
  if (day === null) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

// Overdue is not a stored status: it is an open task whose due date is before today (Toronto).
export function isOverdue(task: ReportTask, today: string): boolean {
  return task.status !== "Approved" && dueStatus(calendarDate(task.dueDate), today) === "overdue";
}

export interface Group {
  key: string;
  count: number;
}

export function groupTasks(tasks: ReportTask[], by: GroupBy, today: string): Group[] {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const key =
      by === "status" ? t.status
      : by === "priority" ? t.priority
      : by === "assignee" ? t.assigneeId
      : isOverdue(t, today) ? "overdue" : "not overdue";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// The Monday of the week containing a calendar date (weeks start on Monday).
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

// Tasks created and tasks due per week, over the requested range. Weeks with no tasks are included as zeros.
export function weeklyTrend(tasks: ReportTask[], from: string, to: string): { week: string; created: number; due: number }[] {
  const weeks = new Map<string, { created: number; due: number }>();
  for (let w = weekStart(from); w <= to; ) {
    weeks.set(w, { created: 0, due: 0 });
    w = addDays(w, 7);
  }
  for (const t of tasks) {
    const c = calendarDate(t.createdAt);
    if (c && c >= from && c <= to) bump(weeks, weekStart(c), "created");
    const d = calendarDate(t.dueDate);
    if (d && d >= from && d <= to) bump(weeks, weekStart(d), "due");
  }
  return [...weeks.entries()].map(([week, v]) => ({ week, ...v }));
}

function bump(weeks: Map<string, { created: number; due: number }>, week: string, field: "created" | "due"): void {
  const row = weeks.get(week);
  if (row) row[field]++;
}

function addDays(date: string, days: number): string {
  let d = date;
  for (let i = 0; i < days; i++) d = nextDay(d);
  return d;
}

// Validates a date-range query: YYYY-MM-DD values, from not after to, and at most two years.
export function validRange(from: string | null, to: string | null): boolean {
  const ok = (v: string | null) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!ok(from) || !ok(to)) return false;
  if (from && to && from > to) return false;
  if (from && to) {
    const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
    return days <= 731;
  }
  return true;
}
