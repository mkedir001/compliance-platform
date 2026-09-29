# Human-services compliance platform — Phase 4

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

## Production authentication

Production uses one explicit `PRODUCTION_AUTH_MODE`. For AWS, set it to
`aws-alb-cognito` and configure `AWS_ALB_AUTH_SIGNER_ARN`,
`AWS_ALB_AUTH_ISSUER`, and `AWS_ALB_AUTH_CLIENT_ID`. The application verifies
the ALB-signed `x-amzn-oidc-data` assertion using AWS's regional HTTPS public-key
endpoint, then maps its signed `sub` claim to `User.authProviderUserId`.
Unsigned `x-amzn-oidc-identity` and development headers are never trusted in
production. The target-group readiness check remains unauthenticated because it
reaches the target directly rather than traversing the authenticated listener.
The ECS task must have outbound HTTPS access to
`public-keys.auth.elb.<region>.amazonaws.com`; deployments in private subnets
without internet egress must add a controlled egress path before enabling this
mode. Key retrieval fails closed.

Link the first bootstrapped administrator exactly once from a controlled task
with production configuration loaded:

```sh
pnpm link:cognito-user -- --user-id <internal-user-id> --cognito-subject <cognito-subject>
# or: pnpm link:cognito-user -- --email <exact-internal-email> --cognito-subject <cognito-subject>
```

The operation requires an active user and organization membership, rejects
conflicts in either direction, fingerprints the external subject in the audit
record, and is idempotent for the identical link. Rollback should restore the
prior container revision and `PRODUCTION_AUTH_MODE`; identity links must not be
silently removed or reassigned.
Future invitees require a controlled Cognito-subject linkage before they can
authenticate and claim an existing portal invitation; matching email alone
never creates that identity link.

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

## Competency and evidence architecture

Phase 4 adds tenant-scoped competency definitions, immutable checklist versions, authorized observed assessments with server-derived results, professional credentials, reviewed external training/equivalency, cryptographically hashed typed-name attestations, subject-area completion evidence, append-only corrections, and opaque-token certificate verification.

Course completion, competency, compliance satisfaction, and work authorization remain separate concepts. Certificates are projections of retained evidence, and revocation never deletes that evidence. Medication authorization, clinical approval, recipient data, document storage, certificate PDF rendering, and polished UI remain deferred.

Development routes include `/admin/competencies` for assessor workflow and `/verify/[token]` for a public-safe certificate projection.

## Phase 5 onboarding, policy governance, and readiness

Employee onboarding uses immutable, versioned templates. Employee steps are projections over canonical employee information, service events, compliance instances, training completions, competency assessments, policy assignments, and credentials; manual administrative checks remain explicitly separate from regulatory evidence. Employees can exist before a `User` account is linked or activated.

Organization policies are versioned independently from courses. Published versions are immutable, assignments reference an exact version, and acknowledgments use the existing authenticated typed-name `Attestation` record and integrity hash. Publishing a replacement never rewrites historical acknowledgments.

The work-readiness engine evaluates `GENERAL_WORK`, `DIRECT_CONTACT`, `UNSUPERVISED_CONTACT`, `PERSON_SPECIFIC_TASK`, and `MEDICATION_ADMINISTRATION` independently at a supplied UTC timestamp. Every block names its canonical source record. Each explicit evaluation appends a versioned `WorkReadinessEvaluation` snapshot; employee compliance profiles and organization operations summaries remain read-only projections.

Medication administration deliberately returns `EVIDENCE_COMPLETE_AUTHORIZATION_NOT_IMPLEMENTED` when no evidence blocks remain. Training, competency, or policy evidence never creates clinical medication authorization.

Work-readiness results are compliance-support determinations based on configured evidence and rules. They are not regulatory agency approval, professional licensure, or clinical authorization.

Functional routes:

- `/admin/compliance-operations` — onboarding, profile, readiness, and operations console.
- `/learn/onboarding` — self-scoped onboarding and policy assignments.
- `/api/organizations/[organizationId]/employees/[employeeId]/onboarding`, `/readiness`, `/profile`, and `/events` — tenant-protected operational APIs.
- `/api/organizations/[organizationId]/policies`, `/policies/versions`, and `/policy-assignments` — policy governance.
- `/api/organizations/[organizationId]/my/onboarding` and `/my/policies` — strict employee self-service.

Service events and readiness snapshots are append-only. Policy acknowledgments, compliance evidence, training completions, competency records, certificates, corrections, and historical readiness results use restrict/supersede semantics rather than cascade deletion.

## Phase 6 production 245D curriculum

The platform catalog now includes globally owned `245D-101` through `245D-112` course concepts. Version 1 of each course contains structured lessons, scenarios, warnings, summaries, versioned assessment banks, objective mappings, and subject-area minute allocations. Estimated durations are product metadata—not statutory minimums.

Curriculum provenance follows `RegulationVersion → ComplianceRequirementVersion → LearningObjective → TrainingCourseVersion → TrainingModule → TrainingContentItem/AssessmentQuestion → employee evidence`. The coverage endpoint reports requirements that are mapped, intentionally contextual, competency-dependent, organization-policy-dependent, assessed, critical-question-covered, or backed by subject evidence.

Activation validation rejects missing modules/content/objectives, objectives without regulatory or content mappings, assessed objectives without questions, critical objectives without critical questions, missing subject allocations or hashes, and obvious placeholder markers. Activated versions are immutable; changes require a new version. An 80% threshold and mandatory correctness for critical safety/reporting questions are platform curriculum policy, not claims about a Minnesota statutory passing score.

`245D-112` is a separately versioned annual refresher with subject minutes allocated across applicable annual topics. It does not replace historical source-course evidence or alter Phase 2 recurrence rules. Generic `245D-103` training does not fabricate acknowledgment of an organization policy. `245D-108` does not establish practical restraint competency, `245D-110` does not create CPR or hands-on first-aid credentials, and the medication demo remains non-authorizing.

Functional curriculum inspection is available at `/admin/training/coverage`, backed by the tenant-protected training coverage and course-validation APIs.
