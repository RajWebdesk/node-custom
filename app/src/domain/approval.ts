import type { Actor } from "./roles.js";

// Approval decision rules from sow-spec Module 10 and the Technical Baseline.
// Status lists are PLACEHOLDER in the spec, so this module returns the outcome,
// not a status string. Only "reject" has a known task status: the task stays In Review.

export type Decision = "approve" | "revise" | "reject";
export const DECISIONS: readonly Decision[] = ["approve", "revise", "reject"];

export interface SubmissionState {
  submittedById: string;
  alreadyDecided: boolean;
}

export type DecisionResult =
  | { ok: true; outcome: Decision; taskStaysInReview: boolean }
  | { ok: false; reason: "not-designated-reviewer" | "own-submission" | "duplicate-decision" };

export function decideApproval(
  actor: Actor,
  submission: SubmissionState,
  decision: Decision,
): DecisionResult {
  // Reviewer identity is enforced: not every Manager can approve.
  if (!actor.isDesignatedReviewer) {
    return { ok: false, reason: "not-designated-reviewer" };
  }
  // Own submissions cannot be approved (Module 10, Task #10.5).
  if (actor.id === submission.submittedById) {
    return { ok: false, reason: "own-submission" };
  }
  // Duplicate decision guard (Task #10.1).
  if (submission.alreadyDecided) {
    return { ok: false, reason: "duplicate-decision" };
  }
  return {
    ok: true,
    outcome: decision,
    // Rejection is recorded as a decision; no Rejected status is added (Technical Baseline).
    taskStaysInReview: decision === "reject",
  };
}
