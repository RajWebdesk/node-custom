# Backup and restore test plan (DRAFT, 2026-10-20)

Backup: daily pg_dump of the local database to a dated file on the Docker host (default D-retention-backup, relayed approval; written confirmation pending).
Restore test: once during the G5 milestone regression. Restore the latest dump into an empty local database, run prisma migrate status and the test suite, record the result. No result is recorded until the test is run.
Owner: WDS team. Approval: pending.
