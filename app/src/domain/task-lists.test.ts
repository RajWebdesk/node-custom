import { describe, expect, it } from "vitest";
import { validateListsUpdate } from "./task-lists.js";

const current = { statuses: ["Waiting"], priorities: ["Low", "Medium", "High"] };
const noUse = { status: {}, priority: {} };

describe("task list rules (Task #13.3)", () => {
  it("accepts adding a status and a priority", () => {
    const r = validateListsUpdate({ statuses: ["Waiting", "On hold"], priorities: ["Low", "Medium", "High", "Urgent"] }, current, noUse);
    expect(r).toEqual({ ok: true, statuses: ["Waiting", "On hold"], priorities: ["Low", "Medium", "High", "Urgent"] });
  });

  it("refuses a built-in workflow status as an extra, ignoring case", () => {
    expect(validateListsUpdate({ statuses: ["in review"], priorities: ["Low"] }, current, noUse)).toEqual({
      ok: false,
      error: "protected-status",
      value: "in review",
      kind: "status",
    });
    expect(validateListsUpdate({ statuses: ["To Do"], priorities: ["Low"] }, current, noUse).ok).toBe(false);
  });

  it("refuses a status that a task still uses when it is removed", () => {
    const r = validateListsUpdate({ statuses: [], priorities: ["Low"] }, current, { status: { Waiting: 2 }, priority: {} });
    expect(r).toEqual({ ok: false, error: "in-use", value: "Waiting", kind: "status" });
  });

  it("refuses removing a priority that a task still uses", () => {
    const r = validateListsUpdate({ statuses: ["Waiting"], priorities: ["Low", "Medium"] }, current, { status: {}, priority: { High: 1 } });
    expect(r).toEqual({ ok: false, error: "in-use", value: "High", kind: "priority" });
  });

  it("allows removing an unused value", () => {
    const r = validateListsUpdate({ statuses: [], priorities: ["Low", "Medium"] }, current, noUse);
    expect(r.ok).toBe(true);
  });

  it("refuses duplicates, empty values, and an empty priority list", () => {
    expect(validateListsUpdate({ statuses: ["a", "A"], priorities: ["Low"] }, current, noUse)).toMatchObject({ error: "duplicate-value" });
    expect(validateListsUpdate({ statuses: ["   "], priorities: ["Low"] }, current, noUse)).toMatchObject({ error: "invalid-value" });
    expect(validateListsUpdate({ statuses: [], priorities: [] }, current, noUse)).toEqual({ ok: false, error: "priority-required" });
  });

  it("enforces the length and count limits", () => {
    expect(validateListsUpdate({ statuses: ["x".repeat(41)], priorities: ["Low"] }, current, noUse)).toMatchObject({ error: "invalid-value" });
    const many = Array.from({ length: 21 }, (_, i) => `s${i}`);
    expect(validateListsUpdate({ statuses: many, priorities: ["Low"] }, current, noUse)).toEqual({ ok: false, error: "too-many", kind: "status" });
  });
});
