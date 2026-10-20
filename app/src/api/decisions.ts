import type { Request, Response } from "express";
import { z } from "zod";
import { DECISIONS, decideApproval, type Decision } from "../domain/approval.js";
import type { Actor, Role } from "../domain/roles.js";
import type { SessionRecord } from "../auth/session.js";
import type { UserAdminStore } from "../auth/reset.js";
import { recordAudit, type AuditStore } from "../audit/audit.js";

// Approval decisions (spec Module 10). Rules live in domain/approval.ts; this handler loads
// the submission and the actor, applies the rules, and records the decision.

export interface SubmissionRecord {
  id: string;
  taskId: string;
  submittedById: string;
  reviewerId: string; // the task's designated reviewer (Task.reviewerId)
  alreadyDecided: boolean;
}

export interface ApprovalStore {
  findSubmission(id: string): Promise<SubmissionRecord | null>;
  recordDecision(submissionId: string, reviewerId: string, decision: Decision): Promise<void>;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly subs = new Map<string, SubmissionRecord>();

  add(record: SubmissionRecord): void {
    this.subs.set(record.id, record);
  }

  async findSubmission(id: string): Promise<SubmissionRecord | null> {
    return this.subs.get(id) ?? null;
  }

  async recordDecision(submissionId: string): Promise<void> {
    const row = this.subs.get(submissionId);
    if (row) row.alreadyDecided = true;
  }
}

const params = z.object({ submissionId: z.string().min(1).max(64) });
const body = z.object({ decision: z.enum(DECISIONS as [Decision, ...Decision[]]) });

export interface DecisionDeps {
  users: UserAdminStore; // findById returns the reviewer flag and roles
  approvals: ApprovalStore;
  audit: AuditStore;
}

export function decisionHandler(deps: DecisionDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = params.safeParse(req.params);
      const b = body.safeParse(req.body);
      if (!p.success || !b.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const session = res.locals.session as SessionRecord;
      const user = await deps.users.findById(session.userId);
      if (!user) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const submission = await deps.approvals.findSubmission(p.data.submissionId);
      if (!submission) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const actor: Actor = {
        id: user.id,
        roles: user.roles as readonly Role[],
        // The reviewer must be the task's designated reviewer AND hold the reviewer flag.
        isDesignatedReviewer: user.isDesignatedReviewer && user.id === submission.reviewerId,
      };
      const result = decideApproval(actor, submission, b.data.decision);
      if (!result.ok) {
        const status = result.reason === "duplicate-decision" ? 409 : 403;
        res.status(status).json({ error: result.reason === "duplicate-decision" ? "already-decided" : "forbidden" });
        return;
      }
      await deps.approvals.recordDecision(submission.id, actor.id, result.outcome);
      await recordAudit(deps.audit, {
        actorId: actor.id,
        action: "approval.decision_recorded",
        entityType: "ApprovalSubmission",
        entityId: submission.id,
        payload: { taskId: submission.taskId, decision: result.outcome, taskStaysInReview: result.taskStaysInReview },
      });

      res.status(201).json({ outcome: result.outcome, taskStaysInReview: result.taskStaysInReview });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
