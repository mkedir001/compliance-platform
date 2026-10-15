# AxisCare integration

Read-only mirror of the agency's AxisCare data (site 10461). Nothing here writes to AxisCare: the client in `src/domain/axiscare/client.ts` only issues GET requests, and refuses any host other than the configured site.

## Settings (environment / secret store, never in git or chat)
| Name | Purpose |
|---|---|
| `AXISCARE_BASE_URL` | `https://10461.axiscare.com` |
| `AXISCARE_API_TOKEN` | API bearer token |
| `AXISCARE_WEBHOOK_ID` | the `x-webhook-id` value AxisCare sends (it is the only webhook credential) |
| `AXISCARE_ORGANIZATION_ID` | Waldah organization that owns the data |
| `AXISCARE_HISTORY_MONTHS` | optional, default 12 |
| `AXISCARE_EXTRA_ENTITIES` | optional comma list to turn on off-by-default data, e.g. `call_log` |

If any required value is missing the webhook returns 503 and the job returns 503; nothing else is affected.

## Flow
- **Webhook** `POST /api/webhooks/axiscare`: checks `x-webhook-id`, stores the raw event (deduped), answers 202, then re-fetches the entity by GET after responding. Failed events are retried by the job (max 5 attempts).
- **Job** `POST /api/jobs/axiscare-sync` (Bearer `JOB_SECRET`, every 15 min in `deployment/production-jobs.json`): retries stored events, syncs clients, caregivers, contacts, applicants, ADLs, tagging categories, organizations (call logs and notes are off; see `AXISCARE_EXTRA_ENTITIES`), then visits, then links clients. `?mode=test` only checks the connection.
- **Visits**: first run backfills `AXISCARE_HISTORY_MONTHS` months; later runs use `updatedSinceDate`. Promoted columns include clock in/out times, method, GPS/phone, service and procedure code, `chargeRateCents`, `billableRateMode`, `verified`, `removed`. `payload` keeps AxisCare's full original JSON.
- **Raw store**: `AxisCareRecord` keeps the full original JSON for every other entity.
- **Client linking**: exact first name + last name + DOB, unique match, links automatically and sets `Client.axisCareClientId` and `axisCareServiceStartDate`. Everything else becomes an `AxisCareClientMatch` row with status `SUGGESTED` that a person confirms (`confirmClientMatch`). A rejected pair is not suggested again.

## Billing screen and access (phase 2)
- Permissions (migration `20261015210000_axiscare_billing_access`): `billing.run` sees everything (visits, rates, clock data, match confirmations) and may bill; `billing.view_billed` sees billed amounts only. New platform role `BILLING` and `ORGANIZATION_OWNER` get both; other roles that could open Billing before get `billing.view_billed` only.
- Billing screen: a linked client's detail lists AxisCare visits from the last 12 months. EVV-compliant visits are pre-selected, others can be added by hand and are flagged "Not EVV compliant" with the reasons. Selection is local only; there is still no billing run or ledger.
- EVV rule (`src/domain/billing/evv.ts`): clock-in and clock-out present and ordered, GPS or phone at both ends, service type present. AxisCare's `verified` flag is not used as EVV.
- One-time match confirmation: banner at the top of Billing (billing.run only) lists suggested matches; Confirm sets the AxisCare client ID on the Waldah client, Reject remembers the decision.
- Notes and call logs: not fetched or stored. Call logs can be turned on with `AXISCARE_EXTRA_ENTITIES=call_log`; a notes fetch can be added to `AXISCARE_ENTITY_CATALOG` in `sync.ts`.
- Medication: AxisCare's API has no medication data; deferred.

## Not done yet
- Billing run, ledger, and the three card figures (approved / billed since start / since last billing).
- Per-visit detail from GetVisit (ADL checklist) if ever needed: `AxisCareVisit.detailPayload` is ready.
- Visit webhook payload shape is undocumented; visit events trigger an incremental visit sync instead.
- PHI: clock GPS and client records are stored; SSN and other sensitive fields are never requested. Access is limited by the permissions above.
- Prisma client must be regenerated and migrations applied; not runnable in the build sandbox, so DB paths are covered by integration tests that need a database and were not run here.
