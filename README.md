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

## Training architecture

Phase 3 adds a platform/global and organization-specific training catalog. Published course versions contain ordered modules, individually version-bound content items, acknowledgments, and assessments. Published or assigned versions are immutable; editing curriculum requires a new version, while assignments, attempts, responses, and completions continue to reference the historical version and content hash.

Compliance requirement versions map explicitly to course versions through `RequirementTrainingOption`. Reconciliation creates idempotent assignments only for default, effective, published mappings. Assignments progress from not started through server-derived completion; clients cannot declare completion, scores, or pass results.

Assessment answer keys remain server-only. Submission loads authoritative questions/options, grades them transactionally, stores immutable response/result snapshots, and enforces configured attempt limits. A single immutable `TrainingCompletion` captures the employee, organization, assignment, exact course/version/hash, final passing attempt, timestamps, content progress, acknowledgments, and evidence snapshot.

Training completion is not automatically equivalent to regulated professional competency when the requirement definition requires separate competency validation. Such assignments stop at `TRAINING_COMPLETE_COMPETENCY_PENDING`; medication course completion never creates clinical approval or medication-administration authorization.

Development routes:

- `/admin/training` — inspect catalog versions and manually assign published training.
- `/learn` — view self-scoped assignments, content, acknowledgments, attempts, and results.
- `/` — workforce/compliance verification console.

All local verification commands remain `pnpm db:migrate`, `pnpm db:seed`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
