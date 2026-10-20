import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../db.js";
import { PrismaAllocationStore } from "../auth/prisma-stores.js";
import { StaleAllocationError } from "./allocation-store.js";

// Task #9.3 (time and audit consistency, concurrency) against the real database.
// Runs only when DATABASE_URL points at a migrated local database.
// Audit rows cannot be deleted (append-only trigger), so this test leaves its audit rows behind by design.

const enabled = Boolean(process.env.DATABASE_URL);
const db = enabled ? createPrismaClient() : (null as never);

describe.runIf(enabled)("allocation concurrency and consistency (Task #9.3)", () => {
  const run = randomBytes(4).toString("hex");
  const subjectId = `alloc-subject-${run}`;
  const actorId = `alloc-admin-${run}`;

  async function setupUsers() {
    await db.user.createMany({
      data: [
        { id: subjectId, name: "Subject", email: `${subjectId}@example.test`, passwordHash: "x", status: "active" },
        { id: actorId, name: "Admin", email: `${actorId}@example.test`, passwordHash: "x", status: "active" },
      ],
    });
  }

  function input(expectedPrevious: number | null, newHours: number) {
    return {
      subjectId,
      expectedPrevious,
      newHours,
      reason: null,
      actorId,
      audit: { actorId, action: "allocation.adjusted", entityType: "Allocation", entityId: subjectId, payload: { newHours } },
    };
  }

  async function counts() {
    const changes = await db.allocationChange.count({ where: { allocation: { subjectId } } });
    const audits = await db.auditEvent.count({ where: { entityId: subjectId, action: "allocation.adjusted" } });
    return { changes, audits };
  }

  afterAll(async () => {
    await db.allocationChange.deleteMany({ where: { allocation: { subjectId } } });
    await db.allocation.deleteMany({ where: { subjectId } });
    await db.user.deleteMany({ where: { id: { in: [subjectId, actorId] } } });
    await db.$disconnect();
  });

  it("lets exactly one of several simultaneous first changes through", async () => {
    await setupUsers();
    const store = new PrismaAllocationStore(db);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => store.applyChange(input(null, i + 1))),
    );
    const won = attempts.filter((a) => a.status === "fulfilled").length;
    const lost = attempts.filter((a) => a.status === "rejected" && a.reason instanceof StaleAllocationError).length;
    expect(won).toBe(1);
    expect(lost).toBe(7);
    // No orphan records: every written change has exactly one audit record, and nothing else was written.
    expect(await counts()).toEqual({ changes: 1, audits: 1 });
  });

  it("applies simultaneous changes to one value without a lost update", async () => {
    const store = new PrismaAllocationStore(db);
    const current = await store.findBySubject(subjectId);
    expect(current).not.toBeNull();
    const base = current!.plannedHours;
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => store.applyChange(input(base, base + 1 + i))),
    );
    const winners = attempts.filter((a): a is PromiseFulfilledResult<Awaited<ReturnType<typeof store.applyChange>>> => a.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const final = await store.findBySubject(subjectId);
    // The stored value is the single winner's value, not a mix of attempts.
    expect(final!.plannedHours).toBe(winners[0].value.allocation.plannedHours);
    // Every successful change added exactly one change row and one audit row, and failures added none.
    expect(await counts()).toEqual({ changes: 2, audits: 2 });
    const history = await store.history(subjectId);
    expect(history.reduce((sum, c) => sum + c.delta, 0)).toBeCloseTo(final!.plannedHours, 2);
  });

  it("stores a change and its audit record together, or neither", async () => {
    const store = new PrismaAllocationStore(db);
    const before = await counts();
    // The actor does not exist, so the update fails on its foreign key after the value check passes.
    // The allocation change and the audit record must both be rolled back.
    const current = await store.findBySubject(subjectId);
    const missing = "missing-user-" + run;
    const broken = { ...input(current!.plannedHours, current!.plannedHours + 5), actorId: missing, audit: { ...input(null, 1).audit, actorId: missing } };
    await expect(store.applyChange(broken)).rejects.toThrow();
    expect((await store.findBySubject(subjectId))!.plannedHours).toBe(current!.plannedHours);
    expect(await counts()).toEqual(before);
  });
});
