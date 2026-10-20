# Code rollback (runbook)

Owner: WDS team (support owner: pm-hazel). Plan: `artifacts/rollback-plan.md`.
Tested: rollback drill on 2026-10-20 to commit `6e822d8` (94 of 94 tests pass against the migrated database).

## When to use
A release breaks the API or web app and the fix is not quick.

## Steps
1. Stop the API and web app.
2. Find the last good commit: `git log --oneline`.
3. Check it out in a separate folder: `git worktree add <folder> <commit>`.
4. In `<folder>/app`: `npm ci`, then `npx prisma generate`.
5. Typecheck and test: `npm run typecheck`, then `npm test` with `DATABASE_URL` set.
6. Start the API and web app from that folder.

## Important
- Migrations are forward-only. A code rollback does not undo the schema. The older code must work with the newer schema; the drill showed this for the commit above.
- If the older code cannot run on the newer schema, use the database restore runbook instead.
