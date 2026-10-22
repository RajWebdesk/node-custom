import { execSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Pilot journeys (Task #15.4 additions, 2026-10-21): drag-and-drop with its audit record, the due-reminder
// job, notifications for review events, reports, and audit history. Accounts come from e2e-seed.ts.
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const API = "http://localhost:3002";
const WEB = "http://localhost:3100";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function createTask(page: Page, title: string, dueDate = "") {
  await page.goto("/tasks/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Assignee").selectOption({ label: "E2E Employee" });
  await page.getByLabel("Designated reviewer").selectOption({ label: "E2E Reviewer" });
  if (dueDate) await page.getByLabel("Due date").fill(dueDate);
  await page.getByRole("button", { name: "Create task" }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname;
}

// A date string (YYYY-MM-DD) that is `days` after today, in UTC. Used so each run has its own reminder slot.
function dayFromToday(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.describe.configure({ mode: "serial" });

test("drag-and-drop moves a card to a free column and writes the audit record", async ({ page, browser }: { page: Page; browser: Browser }) => {
  const title = `Drag journey ${Date.now()}`;
  await signIn(page, "e2e-manager@example.test");
  const taskUrl = await createTask(page, title);
  const taskId = taskUrl.split("/").pop() ?? "";

  await page.goto("/tasks/board");
  const card = page.getByRole("article", { name: title });
  const inProgress = page.getByRole("listitem", { name: /^In Progress,/ });
  await card.dragTo(inProgress);
  await expect(inProgress.getByRole("article", { name: title })).toBeVisible();

  // The status history on the task shows the move.
  await page.goto(taskUrl);
  await expect(page.getByRole("heading", { name: "Status history" })).toBeVisible();
  await expect(page.getByText("In Progress").first()).toBeVisible();

  // The administrator sees the audit record for the move.
  const admin = await browser.newContext({ baseURL: WEB });
  const adminPage = await admin.newPage();
  await signIn(adminPage, "e2e-admin@example.test");
  const res = await admin.request.get(`${API}/api/v1/activity?action=task.status_changed&pageSize=100`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items: { entityId: string; payload: { to?: string } }[] };
  expect(body.items.some((i) => i.entityId === taskId && i.payload.to === "In Progress")).toBe(true);
  await admin.close();
});

test("reminders: the due-reminder job reminds the assignee of a task due the next day", async ({ page, browser }: { page: Page; browser: Browser }) => {
  // A slot 40 to 400 days ahead, unique per run. The task is due the day after the slot day, which is "due tomorrow".
  const offset = 40 + Math.floor(Math.random() * 360);
  const slotDay = dayFromToday(offset);
  const dueDay = dayFromToday(offset + 1);
  const title = `Reminder journey ${Date.now()}`;

  await signIn(page, "e2e-manager@example.test");
  const taskUrl = await createTask(page, title, dueDay);

  // slotDay is generated above as YYYY-MM-DD, so passing it through the shell is safe. Windows needs the shell to find npx.
  const outcome = execSync(`npx tsx e2e/run-reminders.ts ${slotDay}`, { encoding: "utf8", env: process.env }).trim();
  expect(outcome).toContain('"status":"done"');

  const employee = await browser.newContext({ baseURL: WEB });
  const emp = await employee.newPage();
  await signIn(emp, "e2e-employee@example.test");
  await emp.goto("/notifications");
  await expect(emp.locator(`a[href="${taskUrl}"]`).first()).toBeVisible();
  await employee.close();
});

test("notifications: the reviewer is notified of a submission and can mark it read", async ({ page, browser }: { page: Page; browser: Browser }) => {
  const title = `Notify journey ${Date.now()}`;
  await signIn(page, "e2e-manager@example.test");
  const taskUrl = await createTask(page, title);

  const employee = await browser.newContext({ baseURL: WEB });
  const emp = await employee.newPage();
  await signIn(emp, "e2e-employee@example.test");
  await emp.goto(taskUrl);
  await emp.getByRole("button", { name: "Submit for review" }).click();
  await expect(emp.getByText("Submitted for review.")).toBeVisible();
  await employee.close();

  const reviewer = await browser.newContext({ baseURL: WEB });
  const rev = await reviewer.newPage();
  await signIn(rev, "e2e-reviewer@example.test");
  await rev.goto("/notifications");
  await expect(rev.locator(`a[href="${taskUrl}"]`).first()).toBeVisible();
  await rev.getByRole("button", { name: "Mark all as read" }).click();
  await expect(rev.getByText("0 unread.", { exact: false })).toBeVisible();
  await reviewer.close();
});

test("reports: the manager sees the task and planned-time reports", async ({ page }: { page: Page }) => {
  await signIn(page, "e2e-manager@example.test");
  await page.goto("/reports");
  await expect(page.getByRole("table", { name: "Tasks by group" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planned time changes" })).toBeVisible();
});

test("audit history: the administrator sees status changes in the activity log", async ({ page }: { page: Page }) => {
  await signIn(page, "e2e-admin@example.test");
  await page.goto("/activity");
  await expect(page.getByRole("cell", { name: "task.status_changed" }).first()).toBeVisible();
});
