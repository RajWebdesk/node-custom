import { createPrismaClient } from "../db.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaSessionStore, PrismaUserStore } from "./prisma-stores.js";
import { hashPassword } from "./password.js";

// Runs only when DATABASE_URL points at a migrated local database (see README startup steps).
const enabled = Boolean(process.env.DATABASE_URL);
const email = `integration-${Date.now()}@example.test`;

describe.skipIf(!enabled)("Prisma user and session stores", () => {
  const db = createPrismaClient(process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:1/unused");
  let userId = "";

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        email,
        name: "Integration test user",
        passwordHash: await hashPassword("integration-test-password"),
        status: "active",
        roles: { create: [{ role: "MANAGER" }] },
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await db.session.deleteMany({ where: { userId } });
    await db.userRole.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("finds a user by email with roles", async () => {
    const found = await new PrismaUserStore(db).findByEmail(email);
    expect(found?.id).toBe(userId);
    expect(found?.roles).toEqual(["MANAGER"]);
    expect(found?.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("creates, finds, and revokes a session", async () => {
    const store = new PrismaSessionStore(db);
    const created = await store.create(userId, ["MANAGER"], 60);
    expect((await store.find(created.id))?.roles).toEqual(["MANAGER"]);
    await store.revoke(created.id);
    expect(await store.find(created.id)).toBeNull();
  });

  it("refuses an expired session", async () => {
    const store = new PrismaSessionStore(db);
    const created = await store.create(userId, ["MANAGER"], 60);
    await db.session.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await store.find(created.id)).toBeNull();
  });
});
