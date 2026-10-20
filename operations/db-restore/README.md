# Database restore (runbook)

Owner: WDS team (support owner: pm-hazel, per the standalone profile). Plan: `artifacts/restore-plan.md`.
Tested: restore drill on 2026-10-20 (see `outputs/custom-app/gate-records.md`, section "G6 Pre-launch").

## When to use
The local database is lost or damaged, or a migration must be undone by restoring data.

## Steps
1. Stop the API and web app so no writes happen during the restore.
2. Take the newest dump from the backup folder on the Docker host (format: custom, `pg_dump -Fc`).
3. Start an empty database: `docker compose up -d db` (the password comes from `POSTGRES_PASSWORD`, never from this file).
4. Restore into the empty database:
   `docker exec -i <db-container> pg_restore -U app -d app --no-owner < <dump-file>`
5. Check the schema: from `app/`, run `npx prisma migrate status` with `DATABASE_URL` set. It must report that the schema is up to date.
6. Check the audit log is still append-only: an UPDATE on `"AuditEvent"` must fail with "AuditEvent is append-only".
7. Run the test suite: `npm test`. All tests must pass.
8. Start the API and web app again, and sign in with a known account.

## Notes
- Records created after the dump are lost. The team decides whether to re-enter them.
- Never copy real credentials into this file or into the dump notes.
