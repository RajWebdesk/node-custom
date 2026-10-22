import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { decideApproval, DECISIONS, type Decision } from "../domain/approval.js";
import type { Actor, Role } from "../domain/roles.js";
import { canSeeTask, canManageTasks, freeStatusesOf, TASK_STATUSES } from "../domain/tasks.js";
import { canSubmit, canSubmitTask, statusAfterDecision } from "../domain/approvals.js";
import type { SessionRecord } from "../auth/session.js";
import type { UserDirectory } from "../auth/user-directory.js";
import type { TaskStore } from "../tasks/task-store.js";
import type { TaskListStore } from "../tasks/task-list-store.js";
import { DuplicateDecisionError, StaleApprovalError, type ApprovalStore, type SubmissionRecord } from "../approvals/approval-store.js";

// Approval workflow API (spec Module 10, Tasks #10.1 to #10.4). Rules live in domain/approval.ts and
// domain/approvals.ts. Each write goes through the approval store, which applies the change and its
// audit record together.

export interface ApprovalDeps {
  approvals: ApprovalStore;
  tasks: TaskStore;
  directory: UserDirectory;
  // Configured task lists decide which statuses a task can be submitted from (Task #13.3).
  lists?: TaskListStore;
}

const idParams = z.object({ id: z.string().min(1).max(64) });
const emptyBody = z.object({}).strict();
const decisionBody = z.object({ decision: z.enum(DECISIONS as [Decision, ...Decision[]]) }).strict();

function sessionOf(res: Response): SessionRecord {
  return res.locals.session as SessionRecord;
}

async function actorFor(deps: ApprovalDeps, res: Response, reviewerId?: string): Promise<Actor | null> {
  const session = sessionOf(res);
  const user = await deps.directory.findById(session.userId);
  if (!user || user.status !== "active") return null;
  return {
    id: user.id,
    roles: session.roles as readonly Role[],
    // Reviewer identity: the designated-reviewer flag AND the task's designated reviewer (Module 10).
    isDesignatedReviewer: reviewerId === undefined ? user.isDesignatedReviewer : user.isDesignatedReviewer && user.id === reviewerId,
  };
}

async function namesById(deps: ApprovalDeps): Promise<Map<string, string>> {
  return new Map((await deps.directory.list()).map((u) => [u.id, u.name]));
}

// Submit or resubmit a task for review (Task #10.4). The assignee or a manager submits.
export function submitForReviewHandler(deps: ApprovalDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = z.object({ taskId: z.string().min(1).max(64) }).safeParse(req.params);
      const body = emptyBody.safeParse(req.body ?? {});
      if (!p.success || !body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const actor = await actorFor(deps, res);
      const task = await deps.tasks.findById(p.data.taskId);
      if (!actor || !task || !canSeeTask(actor, task)) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      if (!canSubmitTask(actor, task)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const history = await deps.approvals.listForTask(task.id);
      const lastDecision = history.length > 0 ? history[history.length - 1].decision : null;
      const freeStatuses = deps.lists ? freeStatusesOf([...TASK_STATUSES, ...(await deps.lists.read()).statuses]) : undefined;
      const check = canSubmit({ status: task.status, archived: task.archivedAt !== null, lastDecision, freeStatuses });
      if (!check.ok) {
        res.status(check.reason === "forbidden" ? 403 : 409).json({ error: check.reason });
        return;
      }
      const submissionId = randomBytes(16).toString("hex");
      const submission = await deps.approvals.submit(
        {
          submissionId,
          taskId: task.id,
          submittedById: actor.id,
          fromStatus: task.status,
          toStatus: check.changesStatus ? "In Review" : null,
          audit: {
            actorId: actor.id,
            action: "approval.submitted",
            entityType: "ApprovalSubmission",
            entityId: submissionId,
            payload: { taskId: task.id },
          },
          // The designated reviewer is told a submission is waiting (in the same step as the submission).
          notifications: task.reviewerId !== actor.id
            ? [{ recipientId: task.reviewerId, kind: "review.requested", taskId: task.id, payload: { submissionId } }]
            : [],
        },
        actor.id,
      );
      res.status(201).json({ id: submission.id, revisionNo: submission.revisionNo, taskId: task.id });
    } catch (err) {
      if (err instanceof StaleApprovalError) {
        res.status(409).json({ error: "stale-approval" });
        return;
      }
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Approve, revise, or reject (Task #10.1, #10.2). Only the designated reviewer, never on their own submission.
export function decideHandler(deps: ApprovalDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = idParams.safeParse(req.params);
      const body = decisionBody.safeParse(req.body);
      if (!p.success || !body.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      // The signed-in user must resolve to an active account before anything else is checked.
      if (!(await actorFor(deps, res))) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const submission = await deps.approvals.findSubmission(p.data.id);
      if (!submission) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const task = await deps.tasks.findById(submission.taskId);
      if (!task) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const actor = (await actorFor(deps, res, submission.reviewerId))!;
      const check = decideApproval(actor, { submittedById: submission.submittedById, alreadyDecided: submission.decision !== null }, body.data.decision);
      if (!check.ok) {
        const status = check.reason === "duplicate-decision" ? 409 : 403;
        res.status(status).json({ error: check.reason === "duplicate-decision" ? "already-decided" : "forbidden" });
        return;
      }
      if (task.status !== "In Review" || task.archivedAt !== null) {
        res.status(409).json({ error: "not-in-review" });
        return;
      }
      const toStatus = statusAfterDecision(body.data.decision);
      await deps.approvals.decide({
        submissionId: submission.id,
        decidedById: actor.id,
        decision: body.data.decision,
        fromStatus: "In Review",
        toStatus,
        audit: {
          actorId: actor.id,
          action: "approval.decision_recorded",
          entityType: "ApprovalSubmission",
          entityId: submission.id,
          payload: { taskId: task.id, decision: body.data.decision, taskStaysInReview: toStatus === null },
        },
        // The submitter is told the outcome (in the same step as the decision).
        notifications: [{ recipientId: submission.submittedById, kind: "review.decided", taskId: task.id, payload: { submissionId: submission.id, decision: body.data.decision } }],
      });
      res.status(201).json({ outcome: body.data.decision, taskStatus: toStatus ?? "In Review", taskStaysInReview: toStatus === null });
    } catch (err) {
      if (err instanceof DuplicateDecisionError) {
        res.status(409).json({ error: "already-decided" });
        return;
      }
      if (err instanceof StaleApprovalError) {
        res.status(409).json({ error: "stale-approval" });
        return;
      }
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Reviewer queue (Task #10.3): open submissions for the designated reviewer, with task titles.
export function reviewQueueHandler(deps: ApprovalDeps) {
  return async (_req: Request, res: Response) => {
    try {
      const actor = await actorFor(deps, res);
      if (!actor || !actor.isDesignatedReviewer) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const rows = await deps.approvals.listPendingFor(actor.id);
      const names = await namesById(deps);
      const items = [];
      for (const r of rows) {
        const task = await deps.tasks.findById(r.taskId);
        items.push({
          submissionId: r.submissionId,
          taskId: r.taskId,
          taskTitle: task?.title ?? "",
          submitterName: names.get(r.submittedById) ?? "Former user",
          revisionNo: r.revisionNo,
          submittedAt: r.submittedAt,
        });
      }
      res.status(200).json({ items });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Revision history for a task (Task #10.4): every submission with its decision, oldest first.
export function taskReviewsHandler(deps: ApprovalDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = z.object({ taskId: z.string().min(1).max(64) }).safeParse(req.params);
      if (!p.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const actor = await actorFor(deps, res);
      const task = await deps.tasks.findById(p.data.taskId);
      if (!actor || !task || !canSeeTask(actor, task)) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const rows: SubmissionRecord[] = await deps.approvals.listForTask(task.id);
      const names = await namesById(deps);
      res.status(200).json({
        items: rows.map((r) => ({
          submissionId: r.id,
          revisionNo: r.revisionNo,
          submittedAt: r.submittedAt,
          submitterName: names.get(r.submittedById) ?? "Former user",
          decision: r.decision,
          decidedAt: r.decidedAt,
          deciderName: r.decidedById ? names.get(r.decidedById) ?? "Former user" : null,
        })),
      });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}

// Reviewers, assignees, managers, and administrators can read a submission that belongs to a visible task.
export function submissionDetailHandler(deps: ApprovalDeps) {
  return async (req: Request, res: Response) => {
    try {
      const p = idParams.safeParse(req.params);
      if (!p.success) {
        res.status(400).json({ error: "validation-failed" });
        return;
      }
      const actor = await actorFor(deps, res);
      const submission = await deps.approvals.findSubmission(p.data.id);
      const task = submission ? await deps.tasks.findById(submission.taskId) : null;
      if (!actor || !submission || !task || !canSeeTask(actor, task)) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const names = await namesById(deps);
      res.status(200).json({
        id: submission.id,
        taskId: task.id,
        taskTitle: task.title,
        revisionNo: submission.revisionNo,
        submittedAt: submission.submittedAt,
        submitterName: names.get(submission.submittedById) ?? "Former user",
        decision: submission.decision,
        decidedAt: submission.decidedAt,
        deciderName: submission.decidedById ? names.get(submission.decidedById) ?? "Former user" : null,
        canDecide: actor.isDesignatedReviewer && actor.id !== submission.submittedById && submission.decision === null && task.status === "In Review",
        isManager: canManageTasks(actor),
      });
    } catch {
      res.status(500).json({ error: "internal-error" });
    }
  };
}
