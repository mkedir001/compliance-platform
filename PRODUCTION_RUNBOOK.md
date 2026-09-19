# Production deployment runbook

## Required configuration

Set `NODE_ENV=production` and provide `DATABASE_URL`, HTTPS `APP_BASE_URL`, `AUTH_PROXY_SECRET` (32+ random characters), `JOB_SECRET` (32+ random characters), `JOB_ACTOR_USER_ID`, HTTPS `RATE_LIMIT_URL`, `RATE_LIMIT_TOKEN`, and `EVIDENCE_STORAGE_MODE=external-reference`. Optional email requires all of `EMAIL_API_URL`, `EMAIL_API_TOKEN`, and `EMAIL_FROM`; omit all three to use in-app notifications only. Never expose these values to `NEXT_PUBLIC_*` variables.

The trusted identity proxy must send `x-auth-user-id`, Unix-millisecond `x-auth-timestamp`, and `x-auth-signature`, where the signature is lowercase HMAC-SHA256 of `<timestamp>.<userId>` using `AUTH_PROXY_SECRET`. Assertions expire after five minutes. Unsafe browser requests with an `Origin` header must match `APP_BASE_URL`.

Evidence submissions accept opaque `secure:` references or durable HTTPS/S3/GCS/Azure references. This application has no binary upload/download endpoint and must not use ephemeral local disk. The external storage system must enforce private tenant-scoped access, encryption, retention, malware controls, and durable backups.

## Deploy and bootstrap

Install locked dependencies, then run:

```bash
pnpm db:deploy
pnpm build
pnpm start
```

Never run `pnpm db:migrate` or `pnpm db:seed` in production. The demo seed refuses production execution. For a new empty installation, intentionally set `BOOTSTRAP_CONFIRM=CREATE_FIRST_PRODUCTION_ORGANIZATION`, `BOOTSTRAP_ORGANIZATION_NAME`, `BOOTSTRAP_ORGANIZATION_SLUG`, and `BOOTSTRAP_ADMIN_EMAIL`, then run `pnpm bootstrap:production`. It is idempotent only for the exact existing organization/admin link and refuses partial collisions or a different pre-existing organization. Record the created admin user in the selected identity provider.

## Jobs and monitoring

Invoke `POST /api/jobs/compliance` over HTTPS with `Authorization: Bearer <JOB_SECRET>` and JSON `{ "organizationId": "..." }`. Schedule per organization at the desired reconciliation cadence. Each invocation is tenant-scoped, bounded to 500 employees, idempotent at the domain layer, processes at most 100 email deliveries, and uses the active `JOB_ACTOR_USER_ID` membership/permissions. The production rate-limit service must atomically accept `{scope,key,limit,windowSeconds}` and return `{allowed:boolean}`.

Monitor `GET /api/health/live` for process liveness and `GET /api/health/ready` for validated configuration/database readiness. Email is reported as optional and does not make in-app notifications unavailable. Route/job failures emit secret-minimized JSON logs; a monitoring sink can be registered through the observability boundary.

## Recovery

Use automated encrypted PostgreSQL backups with point-in-time recovery appropriate to the organization’s retention policy. Back up private evidence storage and preserve generated audit-package rows with the database. Test restores regularly in an isolated environment. Before rollback, preserve the database, deploy only code compatible with the applied migration chain, and never rewrite or reverse applied migration files. Verify readiness, a representative employee workflow, package checksum access, and job execution after restore or rollback.
