import { expect, test, type Page } from "@playwright/test";

// Journeys across roles (Task #15.4): task and approval, planned time, and the audit trail.
// Accounts come from e2e-seed.ts. The password is read from E2E_PASSWORD.
const PASSWORD = process.env.E2E_PASSWORD ?? "";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
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
  await page.getByLabel("Hours (up to two decimal places)").fill("7.5");
  await page.getByLabel("Reason (optional)").fill("Browser journey");
  await page.getByRole("button", { name: "Save change" }).click();
  await expect(page.getByText("Planned hours changed from")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Browser journey" })).toBeVisible();
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
