# Incident runbook (local pilot)

Owner: WDS team. Support owner: pm-hazel (standalone profile). Plan: `artifacts/incident-plan.md`.

## Health checks
- Liveness: `GET /health/live`. Returns 200 while the API process runs.
- Readiness: `GET /health/ready`. Returns 200 only when the startup configuration is valid and the database answers within 2 seconds. Returns 503 with `database: "unreachable"` when the database does not answer, or `missing_or_invalid` when configuration is wrong.
- Metrics: `GET /metrics` (text format). Request counts and total time by method, route pattern, and status.

## Logs
Every request writes one JSON line to standard output: `ts`, `level`, `msg: "http_request"`, `request_id`, `method`, `route`, `status`, `duration_ms`. Headers, cookies, and bodies are never logged. Find failures with `level` set to `error` (status 500 or higher). Use `request_id` to match a user report to a log line; the same id is returned in the `X-Request-Id` response header.

## Common cases
| Symptom | Check | Action |
|---|---|---|
| API does not start, exits at once | Startup log names the invalid setting by field name | Fix the environment variable (values are never printed). Restart. |
| Readiness 503 `database: unreachable` | `docker compose ps db`; `docker compose logs db` | Start the database, then the API. If data is damaged, use the database restore runbook. |
| Many 500 responses | Filter the log for `level: "error"`, group by `route` | Find the route, reproduce it in a test, fix it, and roll back if needed (deploy recovery runbook). |
| A change reports 500 but the data looks unchanged | The change runs in one transaction, so nothing partial is stored | Check the database, then retry. Audit records are only written together with their change. |
| Login fails for every user | Readiness and the log for `POST /api/v1/auth/login` | Check `SESSION_SECRET` is set and the database answers. |

## Alerts
The standalone profile requires a failure alert for "reminder run failed, or any notification quarantined". Neither the reminder job nor the notification outbox exists yet (Sprint 6). This alert is not in place and must be added with those features. Owner: pm-hazel.

## Not yet in place
- Automatic alerting from the log or metrics output. The pilot is local; a person reads the log and metrics.
