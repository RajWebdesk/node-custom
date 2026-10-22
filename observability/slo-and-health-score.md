# Observability targets and health-score method (pilot, provisional)

Status: **PROVISIONAL, 2026-10-21.** Set for the pilot only. Not a production support commitment. Approval: Delivery head and Tech lead (G5.5). The approval has not been requested or given.

## 1. Targets

| Target | Pilot value | How it is measured | Status |
|---|---|---|---|
| Availability | 99% during agreed pilot hours | Share of minutes in which `GET /health/ready` answers 200, counted only within the pilot hours | Provisional. Pilot hours: [to agree, for example 08:00 to 18:00 America/Toronto on weekdays]. |
| API response time | p95 under 1000 ms | From the `http_request_duration_ms` histogram on `GET /metrics`, per route, over the pilot hours | Provisional |

**Measuring p95 from the histogram.** The `/metrics` output has cumulative buckets at 50, 100, 250, 500, 1000, 2500 and 5000 ms (`le`). A request count of `le="1000"` divided by the total count gives the share of requests under 1000 ms. The p95 target is met when that share is at least 0.95 over the period. Example PromQL, if a Prometheus server is added later:

```
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_ms_bucket[15m])))
```

Without Prometheus, read the buckets directly from `/metrics` at the start and end of a window and subtract.

## 2. Health score

The method follows the project's health-score contract (`health-score.schema.json`): five sub-scores, each 0 to 100, with a rating and a one-line basis. Ratings: GREEN at 80 or more, YELLOW at 60 to 79, RED below 60. The rollup is the worst of the five.

Proposed calculation for the pilot. Each sub-score records its basis in the artifact.

| Sub-score | Value (0 to 100) | Basis to record |
|---|---|---|
| `architecture_health` | Layering fitness tests passed, divided by layering fitness tests run. Penalty: 10 points per boundary violation found. | Count of fitness tests and violations. The layering checks are not yet automated, so this is recorded as "not measured" until they are. |
| `test_health` | Passing tests divided by total tests, in the latest full run on a fresh database. | "N of N unit and integration, M of M browser journeys" |
| `dependency_health` | 100, minus 20 for each production dependency finding of high or critical severity, minus 5 for each moderate finding. Development-only findings are reported but not scored. | Production audit findings by severity |
| `security_health` | Security test pass rate (`security.test.ts`, `login-limit.test.ts`), minus 20 for each open high-severity issue. A critical open issue forces RED. | Test counts and open issues from the known-issues register |
| `delivery_health` | Sprints with G4 passed, divided by sprints built, multiplied by 100. | Sprint list and G4 records |

Baseline recorded at M6 (monitoring). The pilot computes it once, at handoff. The score is recomputed on the schedule the delivery head sets.

## 3. Support ownership

- **Pilot coordination owner (provisional):** sales@webdesksolution.ca, name [to confirm]. Coordinates the pilot. Not a permanent production support assignment.
- Production support owner: not assigned. Production hosting is out of scope for the pilot.

## 4. Not yet measured

- Availability and p95 are only measurable once the API runs in the pilot environment during the pilot hours.
- The layering fitness tests (architecture) do not exist yet.
