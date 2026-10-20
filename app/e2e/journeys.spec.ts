import { expect, test, type Page } from "@playwright/test";

// Journeys across roles (Task #15.4): task and approval, planned time, and the audit trail.
// Accounts come from e2e-seed.ts. The password is read from E2E_PASSWORD.
const PASSWORD = process.env.E2E_PASSWORD ?? "";

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe.configure({ mode: "serial" });

const title = `Browser journey ${Date.now()}`;
let taskUrl = "";

test("task and approval: manager creates, employee submits, reviewer approves", async ({ page, browser }) => {
  await signIn(page, "e2e-manager@example.test");
  await page.goto("/tasks/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Assignee").selectOption({ label: "E2E Employee" });
  await page.getByLabel("Designated reviewer").selectOption({ label: "E2E Reviewer" });
  await page.getByRole("button", { name: "Create task" }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  taskUrl = new URL(page.url()).pathname;

  // Employee submits from their own context.
  const employee = await browser.newContext({ baseURL: "http://localhost:3100" });
  const emp = await employee.newPage();
  await signIn(emp, "e2e-employee@example.test");
  await emp.goto(taskUrl);
  await emp.getByRole("button", { name: "Submit for review" }).click();
  await expect(emp.getByText("Submitted for review.")).toBeVisible();
  await employee.close();

  // Reviewer approves from the queue.
  const reviewer = await browser.newContext({ baseURL: "http://localhost:3100" });
  const rev = await reviewer.newPage();
  await signIn(rev, "e2e-reviewer@example.test");
  await rev.goto("/reviews");
  await rev.getByRole("link", { name: title }).click();
  await rev.getByRole("button", { name: "Approve" }).click();
  await expect(rev.getByText("The task is now Approved.")).toBeVisible();
  await reviewer.close();

  // The manager sees the result on the task.
  await page.goto(taskUrl);
  await expect(page.getByText("Approved", { exact: false }).first()).toBeVisible();
});

test("planned time: administrator changes hours and the change is recorded", async ({ page }) => {
  await signIn(page, "e2e-admin@example.test");
  await page.goto("/time");
  await page.getByRole("button", { name: "E2E Employee" }).click();
  // Increase by a fixed amount with a unique reason, so the change is real on every run (a repeat value is refused).
  const stamp = `Browser journey ${Date.now()}`;
  await page.getByLabel("Change", { exact: true }).selectOption({ label: "Increase by" });
  await page.getByLabel("Hours (up to two decimal places)").fill("0.5");
  await page.getByLabel("Reason (optional)").fill(stamp);
  await page.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByText("Planned hours changed from")).toBeVisible();
  await expect(page.getByRole("cell", { name: stamp })).toBeVisible();
});

test("audit trail: administrator sees the activity; an employee does not", async ({ page, browser }) => {
  await signIn(page, "e2e-admin@example.test");
  await page.goto("/activity");
  await expect(page.getByRole("cell", { name: "allocation.adjusted" }).first()).toBeVisible();

  const employee = await browser.newContext({ baseURL: "http://localhost:3100" });
  const emp = await employee.newPage();
  await signIn(emp, "e2e-employee@example.test");
  await emp.goto("/activity");
  await expect(emp.getByText("You do not have access to this area.")).toBeVisible();
  await employee.close();
});

// User acceptance journeys (Task #16.1): scripted versions of the AS, Hazel and Admin scenarios.
// The people named in the spec still run the real UAT; these prove the paths work end to end.
test("admin journey: create a person, issue a reset token, the person sets a password and signs in", async ({ page, browser }) => {
  const email = `uat-${Date.now()}@example.test`;
  const newPassword = "Uat-new-password-123";
  await signIn(page, "e2e-admin@example.test");
  await page.goto("/users");
  await page.getByLabel("Name", { exact: true }).fill("UAT Person");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByText("User created.")).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(email) });
  await row.getByRole("button", { name: "Issue reset token" }).click();
  const token = (await page.getByRole("status", { name: "Reset token" }).locator("code").textContent())?.trim() ?? "";
  expect(token.length).toBeGreaterThan(20);

  const person = await browser.newContext({ baseURL: "http://localhost:3100" });
  const p = await person.newPage();
  await p.goto("/forgot-password");
  await p.getByLabel("Reset token").fill(token);
  await p.getByLabel("New password (at least 12 characters)").fill(newPassword);
  await p.getByLabel("Confirm new password").fill(newPassword);
  await p.getByRole("button", { name: "Set new password" }).click();
  await p.waitForURL(/\/login$/);
  await signIn(p, email, newPassword);
  await expect(p.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await person.close();
});

test("reviewer journey: request a revision, the employee resubmits, the reviewer approves", async ({ page, browser }) => {
  const revisionTitle = `UAT revision ${Date.now()}`;
  await signIn(page, "e2e-manager@example.test");
  await page.goto("/tasks/new");
  await page.getByLabel("Title").fill(revisionTitle);
  await page.getByLabel("Assignee").selectOption({ label: "E2E Employee" });
  await page.getByLabel("Designated reviewer").selectOption({ label: "E2E Reviewer" });
  await page.getByRole("button", { name: "Create task" }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  const url = new URL(page.url()).pathname;

  const emp = await browser.newContext({ baseURL: "http://localhost:3100" });
  const e = await emp.newPage();
  await signIn(e, "e2e-employee@example.test");
  await e.goto(url);
  await e.getByRole("button", { name: "Submit for review" }).click();
  await expect(e.getByText("Submitted for review.")).toBeVisible();
  await emp.close();

  const rv = await browser.newContext({ baseURL: "http://localhost:3100" });
  const r = await rv.newPage();
  await signIn(r, "e2e-reviewer@example.test");
  await r.goto("/reviews");
  await r.getByRole("link", { name: revisionTitle }).click();
  await r.getByRole("button", { name: "Request revision" }).click();
  await expect(r.getByText("The task is now Revision requested.")).toBeVisible();
  await rv.close();

  const emp2 = await browser.newContext({ baseURL: "http://localhost:3100" });
  const e2 = await emp2.newPage();
  await signIn(e2, "e2e-employee@example.test");
  await e2.goto(url);
  await expect(e2.getByText("Revision requested", { exact: false }).first()).toBeVisible();
  // After a revision request the button reads "Submit for review" ("Send a new revision" is for after a rejection).
  await e2.getByRole("button", { name: "Submit for review" }).click();
  await expect(e2.getByText("Submitted for review.")).toBeVisible();
  await emp2.close();

  const rv2 = await browser.newContext({ baseURL: "http://localhost:3100" });
  const r2 = await rv2.newPage();
  await signIn(r2, "e2e-reviewer@example.test");
  await r2.goto("/reviews");
  await r2.getByRole("link", { name: revisionTitle }).click();
  await r2.getByRole("button", { name: "Approve" }).click();
  await expect(r2.getByText("The task is now Approved.")).toBeVisible();
  await rv2.close();
});

test("manager journey: dashboard, reports, and the task board are reachable", async ({ page }) => {
  await signIn(page, "e2e-manager@example.test");
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Open tasks/ })).toBeVisible();
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await page.goto("/tasks/board");
  await expect(page.getByRole("list", { name: "Task board" })).toBeVisible();
});
