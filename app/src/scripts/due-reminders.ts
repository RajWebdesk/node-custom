// Due-reminder job entry point. The Docker host scheduler runs this often (for example hourly).
// It acts only once the 09:00 America/Toronto slot has started, and only once per day.
// Usage (from app/, with DATABASE_URL set): npx tsx src/scripts/due-reminders.ts
import { createPrismaClient } from "../db.js";
import { runDueReminders } from "../notifications/reminders.js";

const db = createPrismaClient();
try {
  const outcome = await runDueReminders(db);
  console.log(JSON.stringify({ msg: "due_reminders", ...outcome }));
} finally {
  await db.$disconnect();
}
