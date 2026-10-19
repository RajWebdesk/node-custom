# API contract outline (prototype, pre-G3)

Status: outline. Pre-G3 prototype work, not gate evidence. Authentication is not implemented. Every protected route returns 401 until session authentication is formally approved (decisions D1 and D2 in `outputs/custom-app/decisions-register.md`).

Base path: `/api/v1`. All request bodies are validated with Zod. Errors return a generic body, never stack traces or submitted values.

## Health (no authentication)
| Method | Path | Response |
|---|---|---|
| GET | `/health/live` | 200 `{ status: "ok" }` |
| GET | `/health/ready` | 200 `{ status: "ready" }` when startup configuration is valid; 503 `{ status: "not-ready" }` otherwise. No values returned. |

## Approval decisions (spec Module 10)
| Method | Path | Body | Current behaviour |
|---|---|---|---|
| POST | `/api/v1/submissions/:submissionId/decisions` | `{ decision: "approve" \| "revise" \| "reject" }` | 401 without authentication. Rules are in `src/domain/approval.ts`. |

Rules enforced by the domain module (tested in `src/api/app.test.ts`):
- Only the designated reviewer may decide. A Manager who is not the designated reviewer is refused.
- A submitter cannot approve their own submission.
- A second decision on the same submission is refused.
- Rejection is recorded as a decision. The task stays In Review. No Rejected status is added.

## Planned (not implemented)
| Area | Source | Notes |
|---|---|---|
| Users and roles (CRUD, deactivation) | Module 5 | Administrator only |
| Tasks (CRUD, filter, sort, paginate, transitions) | Modules 6 and 7 | Transitions use the same checks as Kanban moves |
| Allocation (Administrator only, transactional, audited) | Module 8 | Planned time, not worked time |
| Audit (append-only) | Module 9 | Secrets and tokens redacted |
| Notifications (in-app list, unread count, mark read) | Module 11 | Email uses the outbox; see `integration-contracts/email.md` |
| Dashboard counts | Module 12 | Role-scoped |
| Reports | Module 13 | Grouping and date filters |

Status lists, priority lists, and the email provider are PLACEHOLDER. Do not add values until the spec or the team defines them.
