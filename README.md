# Human-services compliance platform — Phase 1

Production-oriented multi-tenant foundation for organization structure, global identities, permission-based RBAC, and organization-owned workforce records. No regulatory logic or PHI is included.

## Local setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The seed command prints synthetic development user IDs. Enter one in the foundation console at `http://localhost:3000`. The `x-dev-user-id` adapter is disabled in production and must be replaced by the selected production authentication provider.

Run verification with `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
