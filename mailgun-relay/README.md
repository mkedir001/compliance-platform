# Mailgun transactional-email relay

This Node.js 22 Lambda keeps the Mailgun API credential in AWS Secrets Manager and outside ECS. It accepts one validated message from the private application, enforces the configured sender, calls the configured official US or EU Mailgun API endpoint, and returns only a normalized acceptance or failure result. It never logs recipients, subjects, bodies, credentials, signing URLs, or tokens.

Build with `pnpm --dir mailgun-relay install --frozen-lockfile`, then run `test`, `package`, and `test:package`. Deploy `dist/mailgun-relay.zip` with handler `index.handler`, runtime `nodejs22.x`, and architecture `x86_64`. Required Lambda environment variables are `MAILGUN_SECRET_ID`, `MAILGUN_API_BASE_URL`, `MAILGUN_DOMAIN`, and `MAILGUN_FROM`; values must come from verified Mailgun account/domain configuration.

Provider message IDs are persisted for future signed-webhook reconciliation. Webhook ingestion is intentionally deferred rather than exposing an unauthenticated callback without its signing-secret and replay-protection boundary.
