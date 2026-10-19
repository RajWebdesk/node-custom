# Integration contract: outbound email (STUB, DRAFT)

Status: **draft stub.** Provider-neutral. Not client-approved. No integration code may be written against this contract until it is approved (gate-format: contracts stay `draft` until client sign-off).

Pilot rule: **no real emails are sent during the pilot.** The adapter, if built, uses a non-sending transport in the pilot. Real sending is enabled only after the provider is confirmed.

Sources: [g-contracts-email.md](../../../outputs/custom-app/g-contracts-email.md) (full draft), [sow-spec.md](../../../node-custom-app-skill-windows-compatible-2026-10-16/sow-spec.md) (Task #11.3), [g15-architecture-draft.md](../../../outputs/custom-app/g15-architecture-draft.md) sections 6 and 9.

## 1. Identity
| Field | Value | Status |
|---|---|---|
| Integration | Outbound transactional email | Confirmed (Task #11.3) |
| Direction | Outbound write only | Draft |
| Provider | PLACEHOLDER | Open. WDS team decides. |
| Account owner | PLACEHOLDER | Open. WDS team. |
| Sender verification | PLACEHOLDER | Open. Required before production. |
| System of record | Application database (`Notification`) | Draft |

## 2. Operations
| Operation | Read or write | Source | Notes |
|---|---|---|---|
| Send notification email | Write | `Notification` where `emailStatus = pending` | Content kinds are listed in the full draft. |

## 3. Credentials
- Provider credential referenced by name only (`EMAIL_PROVIDER_API_KEY` in `.env.example`). Never committed.
- Handoff channel: PLACEHOLDER (team).

## 4. Idempotency and failure handling (draft defaults, not approved)
- Default classification: `uncertain-write-escalate`. No automatic retry, quarantine on unknown outcome.
- Upgrade to `idempotent-write` only if the verified provider documents an idempotency key. VERIFY-AT-DISCOVERY.
- Rule (confirmed): email failure never rolls back a task or approval change.

## 5. Limits
- Provider rate and daily quotas: PLACEHOLDER. VERIFY-AT-DISCOVERY.

## 6. Dependencies before real sending
1. Provider confirmed (PLACEHOLDER).
2. Account owner named.
3. Sender verified.
4. Idempotency and limits verified against the provider's documentation.
5. Contract re-confirmed against this file (gate-records: G-Contracts pending).

## 7. Approval
- Client approval: **not recorded.**
