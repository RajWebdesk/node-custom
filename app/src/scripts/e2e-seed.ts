// Seeds the four accounts used by the browser suite (e2e/). Local development database only.
// The password is read from E2E_PASSWORD; it is never written to the repository.
// Usage (from app/, with DATABASE_URL and E2E_PASSWORD set): npx tsx src/scripts/e2e-seed.ts
import { createPrismaClient } from "../db.js";
import { hashPassword } from "../auth/password.js";

const password = process.env.E2E_PASSWORD;
if (!password || password.length < 12) {
  console.error("E2E_PASSWORD must be set and at least 12 characters. Value not shown.");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set.");
  process.exit(2);
}

const accounts = [
  { id: "e2e-admin", name: "E2E Admin", email: "e2e-admin@example.test", roles: ["ADMINISTRATOR"], reviewer: false },
  { id: "e2e-manager", name: "E2E Manager", email: "e2e-manager@example.test", roles: ["MANAGER"], reviewer: false },
  { id: "e2e-reviewer", name: "E2E Reviewer", email: "e2e-reviewer@example.test", roles: ["MANAGER"], reviewer: true },
  { id: "e2e-employee", name: "E2E Employee", email: "e2e-employee@example.test", roles: ["EMPLOYEE"], reviewer: false },
] as const;

const db = createPrismaClient();
try {
  const passwordHash = await hashPassword(password);
  for (const a of accounts) {
    await db.user.upsert({
      where: { id: a.id },
      create: { id: a.id, name: a.name, email: a.email, passwordHash, status: "active", isDesignatedReviewer: a.reviewer,
        roles: { create: a.roles.map((role) => ({ role })) } },
      update: { name: a.name, passwordHash, status: "active", isDesignatedReviewer: a.reviewer,
        roles: { deleteMany: {}, create: a.roles.map((role) => ({ role })) } },
    });
  }
  console.log(JSON.stringify({ msg: "e2e_seed", accounts: accounts.length }));
} finally {
  await db.$disconnect();
}
