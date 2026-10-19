# Migration plan (DRAFT, 2026-10-20)

Tool: Prisma migrate. Strategy: versioned, forward-only, with restore from backup (see restore-plan).
1. Every schema change is a new migration folder under app/prisma/migrations, reviewed in a pull request.
2. Apply with `npx prisma migrate deploy` against the target database.
3. Before applying in any shared environment, take a backup (daily pg_dump, see restore-test-plan).
4. Verify with `npx prisma migrate status`; roll forward with a corrective migration if needed.
Owner: WDS team. Approval: pending (client approver).
