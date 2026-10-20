// Initial account setup (documented process, pilot). Run locally by the WDS team.
// Usage (from app/):
//   ACCOUNT_PASSWORD=<value> npx tsx src/scripts/create-account.ts <email> <name> <ADMINISTRATOR|MANAGER|EMPLOYEE>
// The password is read from the environment only. It is never printed, logged, or committed.
import { createPrismaClient } from "../db.js";
import { hashPassword } from "../auth/password.js";
import { ROLES, type Role } from "../domain/roles.js";

const [email, name, role] = process.argv.slice(2);
const password = process.env.ACCOUNT_PASSWORD;

if (!email || !name || !role || !(ROLES as readonly string[]).includes(role)) {
  console.error("usage: create-account.ts <email> <name> <ADMINISTRATOR|MANAGER|EMPLOYEE>");
  process.exit(2);
}
if (!password || password.length < 12) {
  console.error("ACCOUNT_PASSWORD must be set and at least 12 characters. Value not shown.");
  process.exit(2);
}

const db = createPrismaClient();
try {
  const passwordHash = await hashPassword(password);
  await db.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      passwordHash,
      status: "active",
      roles: { create: [{ role: role as Role }] },
    },
  });
  console.log(`created account for ${email} with role ${role}`);
} catch (err) {
  // Do not print the error object: it can contain the input values.
  console.error("account creation failed (duplicate email or database unavailable)");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
