-- Bind each persisted signer to its template requirement so action eligibility
-- never depends on an unordered relation result after a partial signature.
ALTER TABLE "SignatureSigner"
  ADD COLUMN "requirementKey" TEXT,
  ADD COLUMN "requirementIndex" INTEGER;

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "envelopeId"
    ORDER BY "createdAt", "id"
  ) - 1 AS "requirementIndex"
  FROM "SignatureSigner"
)
UPDATE "SignatureSigner" AS signer
SET "requirementIndex" = ordered."requirementIndex"
FROM ordered
WHERE signer."id" = ordered."id";

ALTER TABLE "SignatureSigner"
  ALTER COLUMN "requirementIndex" SET NOT NULL,
  ALTER COLUMN "requirementIndex" SET DEFAULT 0;

CREATE UNIQUE INDEX "SignatureSigner_envelopeId_requirementIndex_key"
  ON "SignatureSigner"("envelopeId", "requirementIndex");

-- Provider acceptance and downstream delivery evidence are independent states.
ALTER TYPE "SignatureInvitationDeliveryStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "SignatureInvitationDeliveryStatus" ADD VALUE IF NOT EXISTS 'DEFERRED';
ALTER TYPE "SignatureInvitationDeliveryStatus" ADD VALUE IF NOT EXISTS 'BOUNCED';
ALTER TYPE "SignatureInvitationDeliveryStatus" ADD VALUE IF NOT EXISTS 'COMPLAINED';

-- Preserve the newest usable invitation while closing any legacy duplicates that
-- predate database-enforced single-active-token semantics.
WITH ranked_active AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "organizationId", "envelopeId", "signerId"
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS active_rank
  FROM "SignatureInvitation"
  WHERE "status" = 'ACTIVE'
)
UPDATE "SignatureInvitation" AS invitation
SET "status" = 'REVOKED', "revokedAt" = COALESCE(invitation."revokedAt", CURRENT_TIMESTAMP)
FROM ranked_active
WHERE invitation."id" = ranked_active."id"
  AND ranked_active.active_rank > 1;

CREATE UNIQUE INDEX "SignatureInvitation_one_active_per_signer_key"
  ON "SignatureInvitation"("organizationId", "envelopeId", "signerId")
  WHERE "status" = 'ACTIVE';

CREATE TYPE "ImportedSignatureReviewStatus" AS ENUM (
  'UNREVIEWED', 'CONFIRMED_EXTERNAL', 'NEEDS_REVIEW',
  'MISSING_REQUIRED_SIGNATURE', 'REJECTED', 'NOT_APPLICABLE'
);

CREATE TYPE "ImportedValidityReviewStatus" AS ENUM (
  'UNREVIEWED', 'CONFIRMED', 'UNKNOWN', 'NOT_APPLICABLE'
);

ALTER TABLE "ClientImportDocument"
  ADD COLUMN "signatureReviewStatus" "ImportedSignatureReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "validityReviewStatus" "ImportedValidityReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "reviewedExpirationDate" DATE;
