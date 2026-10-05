# First production launch checklist

- [ ] The Mailgun BAA is fully signed/countersigned before launch. This vendor agreement is necessary for intended PHI-capable routing but does not by itself establish HIPAA compliance. Until execution, Mailgun pipeline tests are synthetic and non-PHI only.

## A. Application complete

- [ ] Commit deployed from `main`; `/api/health/live` and `/api/health/ready` configured.
- [ ] Phase 24 verification and production smoke command pass.

## B. External infrastructure to provision

- [ ] Node.js-capable long-running or serverless web runtime selected; no provider is encoded in this repository.
- [ ] Managed PostgreSQL with TLS, encrypted backups, point-in-time recovery, and tested restore.
- [ ] HTTPS identity proxy that strips client `x-auth-*` headers and creates signed assertions.
- [ ] shared atomic rate-limit gateway with bounded TTL; edge proxy separately rate-limits source IP.
- [ ] private durable evidence gateway/object store with encryption, tenant-scoped keys, no listing/public ACLs, malware/content-type checks, size bounds, signed short-lived access, versioning/backup, and retention holds.
- [ ] one scheduler configured from `deployment/production-jobs.json`.

## C. Secrets and values to supply

- [ ] Populate every REQUIRED entry in `.env.production.example` using the deployment secret manager.
- [ ] Set the final HTTPS `APP_BASE_URL`; configure that origin at the identity proxy. No callback route is used: the proxy authenticates before forwarding.
- [ ] Optionally configure all three email variables and a verified sender.

## D. Deployment steps

- [ ] Install with the lockfile; run `pnpm db:deploy`; stop visibly if migration fails.
- [ ] Run `pnpm build`, deploy, start with `pnpm start`; never run `migrate dev`, reset, or seed in production.
- [ ] Configure liveness `/api/health/live` and readiness `/api/health/ready`.

## E. Post-deploy verification

- [ ] Run `pnpm smoke:production`; verify logs, scheduler invocation, database backups, and an isolated restore.
- [ ] Confirm unauthorized job calls fail and overlapping organization jobs cannot run concurrently.

## F. First Radiant Care onboarding

- [ ] Create the real identity-provider admin, then run the intentional production bootstrap once.
- [ ] Complete organization setup and program selection; configure production policies.
- [ ] Import workforce, issue invitations, initialize training/policies, collect credentials/evidence, run reconciliation, review results, verify employee portal, and verify reporting/audit output.
- [ ] Do not import real employees until access, backup, retention, and incident-response owners are confirmed.

Retention for database backups, evidence objects, audit exports, and logs must follow Radiant Care's applicable legal/regulatory policy; this repository does not invent retention periods.
