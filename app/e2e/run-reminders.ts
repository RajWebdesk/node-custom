// Runs the due-reminder job for one slot date, for the browser journeys only.
// Usage (from app/, with DATABASE_URL set): npx tsx e2e/run-reminders.ts 2030-01-01
// The slot is 15:00 UTC on that date, which is between 10:00 and 11:00 in America/Toronto, after the 09:00 slot.
// Journeys use a unique future date per run, so each run gets a fresh slot.
import { createPrismaClient } from "../src/db.js";
import { runDueReminders } from "../src/notifications/reminders.js";

const slotDate = process.argv[2];
if (!slotDate || !/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) {
  console.error("usage: run-reminders.ts YYYY-MM-DD");
  process.exit(2);
}

const db = createPrismaClient();
try {
  const outcome = await runDueReminders(db, new Date(`${slotDate}T15:00:00Z`));
  console.log(JSON.stringify(outcome));
} finally {
  await db.$disconnect();
}
