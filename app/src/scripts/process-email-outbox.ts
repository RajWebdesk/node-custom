// Email outbox entry point. Pilot: EMAIL_PROVIDER is unset, so nothing is sent and each notification is marked suppressed.
// Usage (from app/, with DATABASE_URL set): npx tsx src/scripts/process-email-outbox.ts
import { createPrismaClient } from "../db.js";
import { PrismaNotificationStore, PrismaUserDirectory } from "../auth/prisma-stores.js";
import { processOutbox, transportFromEnv } from "../notifications/email.js";

const db = createPrismaClient();
try {
  const transport = transportFromEnv(process.env);
  const result = await processOutbox({
    notifications: new PrismaNotificationStore(db),
    users: new PrismaUserDirectory(db),
    transport,
    limit: 200,
  });
  console.log(JSON.stringify({ msg: "email_outbox", transport: transport.suppressed ? "pilot-suppressed" : "provider", ...result }));
} finally {
  await db.$disconnect();
}
