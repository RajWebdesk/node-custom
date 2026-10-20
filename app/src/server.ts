import { createPrismaClient } from "./db.js";
import { loadConfig } from "./config/env.js";
import { createApp } from "./api/app.js";
import {
  PrismaApprovalStore,
  PrismaAuditStore,
  PrismaResetStore,
  PrismaSessionStore,
  PrismaUserAdminStore,
  PrismaTaskStore,
  PrismaUserDirectory,
  PrismaUserStore,
} from "./auth/prisma-stores.js";

// Startup: validate configuration first. Refuse to serve if it is invalid.
const result = loadConfig(process.env);
if (!result.ok) {
  // Field names and rules only, never values.
  for (const line of result.errors) console.error(`config: ${line}`);
  process.exit(1);
}

// Database-backed stores (D1 sessions, D2 Argon2id accounts). Prototype: authentication only.
const db = createPrismaClient();
const port = Number(process.env.PORT ?? 3001);
createApp({
  users: new PrismaUserStore(db),
  sessions: new PrismaSessionStore(db),
  userAdmin: new PrismaUserAdminStore(db),
  resets: new PrismaResetStore(db),
  approvals: new PrismaApprovalStore(db),
  userDirectory: new PrismaUserDirectory(db),
  taskStore: new PrismaTaskStore(db),
  audit: new PrismaAuditStore(db),
}).listen(port, () => {
  console.log(`api listening on ${port} (prototype)`);
});
