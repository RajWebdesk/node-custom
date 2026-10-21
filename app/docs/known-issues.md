# Known issues register (pilot, Task #16.4)

Status as of 2026-10-20. Owner is the person who must act. "Open" means not fixed in the current build. "Mitigated" means the cause is addressed but not yet proven gone.

| # | Issue | Impact | Owner | Status |
|---|---|---|---|---|
| 1 | Worker crash in the unit and integration run (exit 0xC0000409). Under the forked-process pool with default workers, 2 of 6 full runs crashed; with two workers, 1 of 5 crashed. Crashes hit different files (`security.test.ts`, `notifications`, `reset`, `profile`, `reports`). Standalone Argon2 stress (600 operations, 3 parallel processes) did not crash, so the hashing library is not confirmed as the cause. Suspected cause: parallel forked workers on Windows. | A full run can fail without a real defect. | Development | Mitigated (commit `bd3213d`): Vitest uses the threads pool. 15 full passing runs and 0 crashes since (2026-10-21 confirmation included); 2 runs aborted with exit 127 before any test output (not explained). Stays Mitigated until the owner decides to close it. |
| 2 | Profile test ("requires the CSRF token ...") failed once under load and has not recurred. | Possible false failure. | Development | Open. Watch. |
| 3 | Task status and priority lists are placeholders; the spec does not define them. | Statuses shown to users are interim. Task 13.3 (configuration screen) not built. | Client (decision) | Open. Blocks 13.3. |
| 4 | Resubmission after a rejection is allowed (task stays In Review, new revision). The spec does not define this. | Behaviour may not match the client's intent. | Client (decision) | Open. Confirm in the AS script, step 5. |
| 5 | Email provider not chosen. Pilot sends nothing; messages are recorded as suppressed. | No email reaches anyone. | WDS team | Open. G-Contracts re-confirmation pending. |
| 6 | No login rate limiting on sign-in or the password change. Not in the spec. | Repeated guessing is not slowed. | Development, with PM decision | Open. Recommended before any pilot use. |
| 7 | Reminder window: "due within 24 hours" is implemented as due today or tomorrow by calendar date. | Reminders may differ slightly from the client's wording. | Client (confirm) | Open. |
| 8 | Notifications are created for review events only. Task assignment changes notify nobody. | Assignees are not told about new work. | Client (decision) | Open. |
| 9 | The reminder failure alert (profile: "reminder run failed, or any notification quarantined") is recorded in data, but no alert is delivered. | A failed reminder run is found only by reading data or logs. | Development and pm-hazel | Open. Needs an alert channel decision. |
| 10 | Docker host scheduler is not configured. The reminder and outbox scripts exist but are not scheduled. | Reminders do not run automatically until scheduled. | WDS team | Open. |
| 11 | Audit records for task create, update, and archive are written after the change, not in the same transaction. Approvals and allocation changes are atomic. | A crash between the change and its audit record leaves the change without its record. | Development | Fixed (uncommitted, branch `fix/task-audit-transaction`). Task create, update, archive and status change now write the audit record in the same transaction. Covered by `prisma-task-audit.integration.test.ts`. |
| 12 | Drag-and-drop on the Kanban board has not been checked in a real browser. The keyboard "Move to" control has. | Drag-and-drop may fail on some browsers. | Development and UAT | Open. |
| 13 | Board shows at most 100 tasks; report lists show at most 200 rows (the screen says when cut). | Large data sets are cut. | Development | Accepted for the pilot. |
| 14 | Due dates are calendar dates stored as UTC midnight; no time of day. | No time-of-day due dates. | Client (confirm) | Accepted for the pilot. |
| 15 | The browser suite has 6 journeys. The spec describes wider coverage. | Some paths are covered only by API tests. | Development | Open. Extend before sign-off. |
| 16 | Human UAT with AS, Hazel, and the Administrator is still to be run (scripts in `docs/uat-scripts.md`). | Acceptance is not yet recorded. | AS, Hazel, Administrator | Open. |
| 17 | Missing approvals: rollback and restore plans (drafts), observability SLO targets, monitoring health score method, and M6 ownership. Written confirmation of Hazel's sign-offs is not on file. | G5.5, G6, and M6 cannot pass. | pm-hazel | Open. |
| 18 | QA lead (PG) reviews of Sprints 2, 5, 6, 8, and 9 are pending. | Sprint gates cannot be closed. | QA lead (PG) | Open. |
| 19 | Production hosting is out of scope. | Nothing is deployed beyond the local machine. | Not applicable | By scope. |
| 20 | Reminder due dates were compared with midnight UTC of tomorrow, so a task due later on tomorrow was not reminded. | Some tasks due tomorrow missed their reminder. | Development | Fixed (commit `e624bce`). Integration test covers a due time later on tomorrow. |
