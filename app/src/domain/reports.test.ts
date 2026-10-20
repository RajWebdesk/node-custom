import { describe, expect, it } from "vitest";
import { groupTasks, inRange, isOverdue, validRange, weekStart, weeklyTrend, type ReportTask } from "./reports.js";

// Task #13.1: report rules, checked directly.
const task = (over: Partial<ReportTask>): ReportTask => ({
  status: "To Do",
  priority: "Low",
  assigneeId: "a",
  createdAt: new Date("2026-10-05T12:00:00Z"),
  dueDate: null,
  archivedAt: null,
  ...over,
});

describe("task report rules (Task #13.1)", () => {
  it("groups by status, priority, assignee, and overdue", () => {
    const tasks = [
      task({ status: "To Do", priority: "High", assigneeId: "a" }),
      task({ status: "To Do", priority: "Low", assigneeId: "b" }),
      task({ status: "Approved", priority: "High", assigneeId: "a" }),
    ];
    expect(groupTasks(tasks, "status", "2026-10-20")).toEqual([
      { key: "To Do", count: 2 },
      { key: "Approved", count: 1 },
    ]);
    expect(groupTasks(tasks, "priority", "2026-10-20")).toEqual([
      { key: "High", count: 2 },
      { key: "Low", count: 1 },
    ]);
    expect(groupTasks(tasks, "assignee", "2026-10-20")).toEqual([
      { key: "a", count: 2 },
      { key: "b", count: 1 },
    ]);
  });

  it("counts a task as overdue only while open and past its due date", () => {
    const late = task({ dueDate: new Date("2026-10-18T00:00:00Z") });
    expect(isOverdue(late, "2026-10-20")).toBe(true);
    expect(isOverdue({ ...late, status: "Approved" }, "2026-10-20")).toBe(false);
    expect(isOverdue(task({ dueDate: new Date("2026-10-20T00:00:00Z") }), "2026-10-20")).toBe(false);
    expect(isOverdue(task({ dueDate: null }), "2026-10-20")).toBe(false);
  });

  it("filters by an inclusive calendar range on the chosen date field", () => {
    const t = task({ createdAt: new Date("2026-10-05T23:30:00Z"), dueDate: new Date("2026-10-12T00:00:00Z") });
    expect(inRange(t, "createdAt", "2026-10-05", "2026-10-05")).toBe(true);
    expect(inRange(t, "createdAt", "2026-10-06", null)).toBe(false);
    expect(inRange(t, "dueDate", "2026-10-12", "2026-10-12")).toBe(true);
    expect(inRange(task({ dueDate: null }), "dueDate", null, null)).toBe(true);
    expect(inRange(task({ dueDate: null }), "dueDate", "2026-10-01", null)).toBe(false);
  });

  it("starts weeks on Monday and returns zero weeks inside the range", () => {
    expect(weekStart("2026-10-20")).toBe("2026-10-19"); // Tuesday to Monday
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    const trend = weeklyTrend([task({ createdAt: new Date("2026-10-20T12:00:00Z") })], "2026-10-05", "2026-10-25");
    expect(trend.map((w) => w.week)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(trend.find((w) => w.week === "2026-10-19")!.created).toBe(1);
    expect(trend.find((w) => w.week === "2026-10-12")!.created).toBe(0);
  });

  it("refuses an inverted or over-long range and malformed dates", () => {
    expect(validRange("2026-10-10", "2026-10-01")).toBe(false);
    expect(validRange("2024-01-01", "2026-10-01")).toBe(false);
    expect(validRange("10/10/2026", null)).toBe(false);
    expect(validRange("2026-10-01", "2026-10-31")).toBe(true);
    expect(validRange(null, null)).toBe(true);
  });
});
