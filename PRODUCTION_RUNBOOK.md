# Production deployment runbook

No hosting provider is encoded in this repository. Deploy to the selected Node.js-compatible HTTPS runtime with managed PostgreSQL and the external services below; do not use ephemeral disk. `.env.production.example` is the authoritative production environment manifest.

## Required service contracts

The trusted identity proxy must terminate HTTPS, strip all inbound `x-auth-user-id`, `x-auth-timestamp`, and `x-auth-signature` headers, authenticate the person, and inject a lowercase HMAC-SHA256 signature of `<timestamp>.<userId>` using `AUTH_PROXY_SECRET`. Timestamps are Unix milliseconds and expire after five minutes. Configure the final `APP_BASE_URL` as the allowed application origin; there is no application callback endpoint. Server-side current user, membership, workforce state, RBAC, and clinical privileges remain authoritative. The edge must also independently enforce source-IP abuse limits because the application intentionally does not trust forwarding headers for client IP.

The shared rate-limit gateway receives HTTPS `POST` JSON `{scope,key,limit,windowSeconds}` with bearer authentication and returns `{allowed:boolean}`. Keys are SHA-256 digests, counters must be atomic across instances, and TTL must not exceed `windowSeconds`. Unavailability fails protected operations closed.

The private evidence gateway receives bearer-authenticated HTTPS `POST` requests at `EVIDENCE_STORAGE_URL`. `{operation:"health"}` returns `{ok:true}`. `{operation:"verify",organizationId,reference}` returns `{ok:true}` only when the opaque reference identifies a completely uploaded object owned by that tenant. It must generate tenant-scoped unpredictable keys, validate content type and size, reject partial/malicious uploads, encrypt objects, disable public ACLs/listing, and issue only short-lived signed access after application authorization. References must remain stable for audit history; separation must never delete evidence automatically. CORS is unnecessary because the application exchanges only references with this server-to-server gateway. Storage versioning, retention holds, backup, and deletion must follow the organization's approved policy.

Optional email uses the configured HTTPS adapter. Set all of `EMAIL_API_URL`, `EMAIL_API_TOKEN`, and `EMAIL_FROM`, or none. Provider failures retry up to the existing bounded delivery policy; absent email leaves in-app notifications operational.

## Deploy, migrate, and bootstrap

Install locked dependencies and run the release step before routing traffic:

```bash
pnpm db:deploy
pnpm build
pnpm start
```

`DATABASE_URL` must be a TLS PostgreSQL connection suitable for both Prisma runtime and committed migration deployment. If a runtime pooler cannot run DDL, execute `pnpm db:deploy` in the release environment with a direct TLS URL, then restore the pooled runtime URL before start. Never run `prisma migrate dev`, reset, or seed in production; migration failure must fail the release.

For the first organization, create the real admin in the identity provider, then set `BOOTSTRAP_CONFIRM=CREATE_FIRST_PRODUCTION_ORGANIZATION`, `BOOTSTRAP_ORGANIZATION_NAME`, `BOOTSTRAP_ORGANIZATION_SLUG`, and `BOOTSTRAP_ADMIN_EMAIL` and run `pnpm bootstrap:production`. The command is intentional, audited, duplicate-safe for an exact repeat, refuses collisions, and creates no demo records. Configure the returned user ID as appropriate in the identity proxy; use a separate active least-privilege `JOB_ACTOR_USER_ID` membership for jobs.

## Jobs, health, smoke, and recovery

Configure exactly the schedule in `deployment/production-jobs.json`, replacing `${PRODUCTION_ORGANIZATION_ID}` in the scheduler secret/config store. It invokes one tenant per run with `Authorization: Bearer <JOB_SECRET>`. Work is bounded, domain-idempotent, transaction-lock protected against overlap, and logs completion/failure without secrets.

Use `GET /api/health/live` for process liveness. `GET /api/health/ready` validates required configuration, database, rate limiter, and evidence gateway; optional email never makes readiness fail. Run `pnpm smoke:production` after deployment with `SMOKE_BASE_URL`; authenticated read checks additionally require `SMOKE_USER_ID` and `AUTH_PROXY_SECRET`. Set `SMOKE_ORGANIZATION_ID` for tenant checks and `SMOKE_RUN_JOB=true` only when reconciliation is safe.

Capture structured stdout/stderr logs in the selected platform. Alert on request, database, rate-limit, evidence-storage, export, email, and job failures. The observability sink remains provider-neutral.

Use encrypted PostgreSQL backups with point-in-time recovery and private evidence versioning/backups. Preserve audit rows and evidence references. Test restores in isolation. Roll back only to code compatible with already-applied migrations; never rewrite migrations. Retention for database backups, evidence, audit packages, and logs must follow the organization's approved legal/regulatory policy.
