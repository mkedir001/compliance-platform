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

## Not done yet (next steps)
- Review screen for suggested matches (data and `confirmClientMatch` exist; no UI yet).
- Per-client sub-resources (client ADL lists, notes, per-visit detail from GetVisit) and schedules; `AxisCareVisit.detailPayload` is ready for GetVisit.
- Billing screen wiring to `AxisCareVisit` (rate = `chargeRateCents`).
- Visit webhook payload shape is undocumented; visit events trigger an incremental visit sync instead.
- PHI: "everything" includes notes, call logs, GPS and ADLs. SSN and other sensitive fields are never requested. Restrict who may read these tables when screens are built.
- Prisma client must be regenerated (`prisma generate`) and the migration applied; this was not runnable in the build sandbox, so it was verified by unit tests only.
