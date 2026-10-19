# Sprint 1 traceability and workflow rules (Tasks #1.1 and #1.2)

Status: working document for Sprint 1. Pre-G3 prototype work, not gate evidence. Source: `sow-spec.md` (Technical SOW rules, Modules 1 to 3, 6, and 10).

## 1. Role mapping (Task #1.1)
| Person | Application role | Notes |
|---|---|---|
| Hazel | Manager (Project Manager) | Confirmed in spec |
| AS | Manager with designated-reviewer responsibility | Only the designated reviewer can approve. Not every Manager can. |
| Administrator (account to be created by the documented setup process) | Administrator | Changes allocated time. Manages users and roles. |
| Employees | Employee | Submit and resubmit tasks |

## 2. Acceptance criteria traced to rules
| Rule (spec) | Where enforced | Test |
|---|---|---|
| Permissions and workflow rules enforced on the backend | `src/domain/approval.ts`, `src/domain/roles.ts` | `src/api/app.test.ts`, approval and roles blocks |
| Only designated reviewer approves | `decideApproval` | "a Manager who is not the designated reviewer cannot approve" |
| Own submissions cannot be approved | `decideApproval` | "a reviewer cannot approve their own submission" |
| Rejection is a decision; task stays In Review; no Rejected status | `decideApproval` (`taskStaysInReview`) | "rejection is recorded and the task stays In Review" |
| Only the Administrator changes allocated time | `canChangeAllocation` | "only the Administrator changes allocation" |
| Startup configuration validated; no secrets in source | `src/config/env.ts` | `src/config/env.test.ts` |
| Audit append-only | Schema and SQL (not implemented in API yet) | Pending, Module 9 |
| Email failures do not undo task changes | Outbox design (`integration-contracts/email.md`) | Pending, Module 11 |

## 3. Workflow state transitions (Task #1.2)
| From | Action | To | Notes |
|---|---|---|---|
| (task created) | Submit for review | In Review | Creates a submission with revision number |
| In Review | Approve (designated reviewer, not own submission) | Approved (status name PLACEHOLDER) | One decision per submission |
| In Review | Revise (designated reviewer) | Revision requested (status name PLACEHOLDER) | Employee resubmits; new revision number |
| In Review | Reject (designated reviewer) | In Review | Recorded as a decision. No Rejected status (spec). |
| Any | Kanban move | Must call the same transition check as the normal action | Module 6.3, Task #7.3 |

Status names other than "In Review" are PLACEHOLDER. The spec does not define them. Do not add values until the team defines them.

## 4. Open edge cases (for the team)
- Post-rejection follow-up: no follow-up defined (confirmed 2026-10-19: rejection sends the rejected email only).
- Mandatory reason for time changes: not mandatory (confirmed 2026-10-19).
- Revision cap and resubmission limits: not defined in the spec.
