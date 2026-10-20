# API reference (local pilot)

Base URL: `http://localhost:3001` (API). All responses are JSON except `/metrics` (text) and `204` responses (no body).

## Conventions
- **Sign-in:** `POST /api/v1/auth/login` sets an `HttpOnly`, `SameSite=Strict` session cookie and returns a `csrfToken`. Send the cookie with every request.
- **CSRF:** every write (`POST`, `PATCH`) needs the header `X-CSRF-Token` with that token. Without it the API answers `403 csrf-check-failed`.
- **Errors:** `{ "error": "<code>" }`. Common codes: `validation-failed` (400), `authentication-required` (401), `forbidden` or `csrf-check-failed` (403), `not-found` (404, also used when a record exists but is not visible to you), `invalid-*` and `*-refused` (400 or 409 with a business reason), `payload-too-large` (413), `malformed-request` (400), `internal-error` (500, no details).
- **Request ids:** send `X-Request-Id` (8 to 64 letters, digits, or dashes) to correlate logs; the same id comes back in the response.
- **Visibility:** employees see only their own tasks, submissions, allocation, and notifications. Administrators and managers see all tasks. Administrator-only routes answer 403 to everyone else.
- **Dates:** calendar dates are `YYYY-MM-DD`; timestamps are ISO 8601. Reports and reminders use America/Toronto.

## Health and metrics (no session)
| Method | Path | Notes |
|---|---|---|
| GET | `/health/live` | 200 while the process runs |
| GET | `/health/ready` | 200 when configuration is valid and the database answers; 503 otherwise (no details) |
| GET | `/metrics` | Request counts and total time, text format |

## Authentication and profile
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/login` | any | Body `{email, password}`. Generic failure for wrong email or password. |
| POST | `/api/v1/auth/logout` | signed in | CSRF. Ends the session. |
| POST | `/api/v1/auth/reset` | any | Body `{token, newPassword}`. Single-use token from an administrator. |
| GET | `/api/v1/me` | signed in | Own profile. No password hash. |
| PATCH | `/api/v1/me` | signed in | CSRF. Display name only (`{name}`). |
| POST | `/api/v1/me/password` | signed in | CSRF. `{currentPassword, newPassword}`. Ends every session. |

## Administration (administrator only)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/users` | All accounts, without password hashes |
| POST | `/api/v1/admin/users` | CSRF. `{name, email, roles}`. New account has no usable password until a reset token is issued. |
| PATCH | `/api/v1/admin/users/:id` | CSRF. `{name?, roles?, status?}`. Deactivation and role changes end the user's sessions. Cannot deactivate yourself or drop your own Administrator role. |
| POST | `/api/v1/admin/users/:id/reset-token` | CSRF. Returns a one-time token, shown once. |
| GET | `/api/v1/admin/settings` | Approved settings and the role matrix. Read-only. |
| POST | `/api/v1/admin/allocations/:id/adjust` | CSRF. `{mode: set|increase|decrease, hours, reason?}`. Planned hours only. |
| GET | `/api/v1/activity` | Audit log, filters `entityType`, `action`, `actorId`, paged |

## Users and directory
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/v1/directory/users` | Manager, Administrator | Active users (id, name, reviewer flag). No email addresses. |

## Tasks
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/v1/tasks` | signed in (scoped) | Filters `q`, `status`, `priority`, `assigneeId`, `archived`; sort `sortBy`, `sortDir`; paging `page`, `pageSize` (max 100) |
| POST | `/api/v1/tasks` | Manager, Administrator | CSRF. `{title, priority, assigneeId, reviewerId, description?, startDate?, dueDate?}` |
| GET | `/api/v1/tasks/:id` | signed in (scoped) | |
| PATCH | `/api/v1/tasks/:id` | Manager, Administrator | CSRF. Title, description, priority, assignee, dates, `archived`. Archived tasks accept only unarchiving. |
| POST | `/api/v1/tasks/:id/status` | Manager, Administrator | CSRF. `{status}`. Only To Do and In Progress; approval statuses are set by the review workflow. |
| GET | `/api/v1/tasks/:id/history` | signed in (scoped) | Status changes |

## Review workflow
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/v1/tasks/:id/submissions` | assignee, Manager, Administrator | CSRF. Submit or resubmit for review. |
| GET | `/api/v1/tasks/:id/reviews` | signed in (scoped) | Revision history with decisions |
| GET | `/api/v1/reviews` | designated reviewer | Open submissions waiting for a decision |
| GET | `/api/v1/submissions/:id` | signed in (scoped) | Includes `canDecide` |
| POST | `/api/v1/submissions/:id/decisions` | designated reviewer | CSRF. `{decision: approve|revise|reject}`. Not on your own submission. One decision per submission. |

## Planned time
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/v1/allocations` | signed in (scoped) | Planned hours per active person |
| GET | `/api/v1/allocations/:id/history` | signed in (scoped) | Changes, newest first |

## Dashboard, reports, notifications
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/v1/dashboard` | signed in (scoped) | Counts and recent activity |
| GET | `/api/v1/reports/tasks` | signed in (scoped) | `groupBy`, `dateField`, `from`, `to`, `archived`; trend when both dates are set |
| GET | `/api/v1/reports/time` | signed in (scoped) | Planned-time changes in a range |
| GET | `/api/v1/reports/history` | signed in (scoped) | Status changes in a range |
| GET | `/api/v1/notifications` | signed in | Own inbox. `unread=true`, `limit` |
| POST | `/api/v1/notifications/:id/read` | signed in | CSRF. Own notifications only. |
| POST | `/api/v1/notifications/read-all` | signed in | CSRF |

## Scheduled jobs (not HTTP)
- Due reminders: `npx tsx src/scripts/due-reminders.ts` (run by the Docker host scheduler; acts once per day after 09:00 Toronto).
- Email outbox: `npx tsx src/scripts/process-email-outbox.ts` (pilot: records messages as suppressed; sends nothing).
