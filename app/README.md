# Standalone Task & Approval Management: application (pilot prototype)

Status: prototype. Not a finished application. G3 is not passed. Pre-G3 work is not gate evidence.

## Layout
- `src/config/env.ts`: startup configuration validation. Names match `.env.example`.
- `src/domain/`: roles and approval rules (spec Module 10 and the Technical Baseline).
- `src/api/app.ts`: Express API skeleton. Health endpoints and a validated decision route (401 until authentication is approved).
- `src/server.ts`: starts the API after validating configuration.
- `prisma/`: baseline schema from the G-Schema draft, and two migrations.
- `docs/api-contract.md`: API contract outline.
- `docs/sprint-1-traceability.md`: role mapping, rules, and transitions.
- `web/`: Next.js shell with Clean Enterprise tokens, Dashboard and Login pages on mock data.
- `../docker-compose.yml` (project root): local PostgreSQL only. No production hosting.
- `../.github/workflows/ci.yml` (project root): runs the `app` package only. The `web` package is not in CI yet.

## Startup (local)
Set these in your local environment. Never commit them.
- `POSTGRES_PASSWORD`, for the database container.
- `DATABASE_URL`, for Prisma and the API.
- The variables in `.env.example`.

Steps, from the project root unless noted:
1. Start the database: `docker compose up -d db`. Wait until it reports healthy.
2. From `app/`: `npm ci`, then `npx prisma migrate deploy`.
3. From `app/`: `npm run typecheck`, then `npm test`.
4. Start the API from `app/`: `npx tsx src/server.ts` (or build and run with Node). It listens on `PORT`, default 3001.
5. Start the web shell from `app/web/`: `npm run dev`, then open http://localhost:3000.
6. Stop the database: `docker compose down`.

## Checks
- Typecheck: passes.
- Tests: 17 pass (API and domain).
- Web production build: passes.
- Migrations: applied to the local database.

## Not included yet
- Session authentication and password hashing (waiting on approval of D1 and D2).
- Real data, the remaining mandatory pages, and the business modules.
- Repository creation, the CI run, and the Tech lead spot-check (WDS team and named approvers).
