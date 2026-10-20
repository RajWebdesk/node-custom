import type { Request, Response } from "express";
import { z } from "zod";
import type { UserDirectory } from "../auth/user-directory.js";
import type { SessionRecord } from "../auth/session.js";
import type { Actor, Role } from "../domain/roles.js";
import { ADJUST_MODES, canViewAllocation, computeAdjustment } from "../domain/allocation.js";
import { StaleAllocationError, type AllocationStore } from "../allocation/allocation-store.js";

// Planned time allocation API (spec Module 8, Tasks #8.2 and #8.3). Rules live in domain/allocation.ts.
// The adjust route is mounted behind requireAdministrator in app.ts.

export interface AllocationDeps {
  allocations: AllocationStore;
  directory: UserDirectory;
}

const subjectParams = z.object({ subjectId: z.string().min(1).max(64) });

const adjustBody = z
  .object({
    mode: z.enum(ADJUST_MODES),
    hours: z.number().finite(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

function actorOf(res: Response): Actor {
  const session = res.locals.session as SessionRecord;
  return { id: session.userId, roles: session.roles as readonly Role[], isDesignatedReviewer: false };
}

export function listAllocationsHandler(deps: AllocationDeps) {
  return async (_req: Request, res: Response) => {
    try {
      const actor = actorOf(res);
      const [users, rows] = await Promise.all([deps.directory.list(), deps.allocations.list()]);
      const byId = new Map(rows.map((r) => [r.subjectId, r]));
      const items = users
        .filter((u) => u.status === "active" && canViewAllocation(actor, u.id))
        .map((u) => {
          const row = byId.get(u.id);
          return {
            subjectId: u.id,
            name: u.name,
            // null means no allocation has been set yet, which is different from 0 hours.
            plannedHours: row ? row.plannedHours : null,
            updatedAt: row ? row.updatedAt : null,
          };
        });
      res.status(200).json({ items });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

export function allocationHistoryHandler(deps: AllocationDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = subjectParams.safeParse(req.params);
      if (!p.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      if (!canViewAllocation(actorOf(res), p.data.subjectId)) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const [changes, users] = await Promise.all([deps.allocations.history(p.data.subjectId), deps.directory.list()]);
      const names = new Map(users.map((u) => [u.id, u.name]));
      const items = changes
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .map((c) => ({
          at: c.at,
          actorName: names.get(c.actorId) ?? "Former user",
          previousHours: c.previousHours,
          newHours: c.newHours,
          delta: c.delta,
          reason: c.reason,
        }));
      res.status(200).json({ items });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Increase, decrease, or set. The current value is read, the rule is applied, and the store refuses
// the change if the value moved in the meantime (the client then retries with the new value).
export function adjustAllocationHandler(deps: AllocationDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = subjectParams.safeParse(req.params);
      const body = adjustBody.safeParse(req.body);
      if (!p.success || !body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const subject = await deps.directory.findById(p.data.subjectId);
      if (!subject) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      if (subject.status !== "active") {
        res.status(400).json({ error: "invalid-subject" });
        return;
      }
      const actor = actorOf(res);
      const current = await deps.allocations.findBySubject(subject.id);
      const currentHours = current ? current.plannedHours : 0;
      const result = computeAdjustment(currentHours, body.data.mode, body.data.hours);
      if (!result.ok) {
        res.status(400).json({ error: result.reason });
        return;
      }
      const reason = body.data.reason ? body.data.reason : null;
      const { change } = await deps.allocations.applyChange({
        subjectId: subject.id,
        expectedPrevious: current ? current.plannedHours : null,
        newHours: result.newHours,
        reason,
        actorId: actor.id,
        audit: {
          actorId: actor.id,
          action: "allocation.adjusted",
          // One allocation per person, so the subject id identifies it.
          entityType: "Allocation",
          entityId: subject.id,
          payload: { mode: body.data.mode, previousHours: result.previousHours, newHours: result.newHours, delta: result.delta, reason },
        },
      });
      res.status(201).json({ changeId: change.id, previousHours: change.previousHours, newHours: change.newHours, delta: change.delta });
    } catch (err) {
      if (err instanceof StaleAllocationError) {
        res.status(409).json({ error: "stale-allocation" });
        return;
      }
      res.status(500).json({ error: "internal-error" });
    }
  };
}
