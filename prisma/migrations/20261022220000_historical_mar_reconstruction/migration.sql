-- Additive retrospective MAR lifecycle. Existing staged and attested records retain
-- their current semantics while new reconstruction records carry explicit state.
ALTER TYPE "HistoricalMarReviewState" ADD VALUE IF NOT EXISTS 'SOURCE_VERIFIED';

CREATE TYPE "HistoricalMarReconstructionState" AS ENUM ('SCHEDULED', 'RECONSTRUCTED');
CREATE TYPE "HistoricalMedicationAuthorizationState" AS ENUM ('APPROVED', 'UNAPPROVED_DRAFT', 'HISTORY_UNRESOLVED');

ALTER TABLE "ClientMedication"
  ADD COLUMN "historicalApprovedFrom" DATE,
  ADD COLUMN "historicalApprovedThrough" DATE,
  ADD COLUMN "historicalApprovalSourceReference" TEXT;

ALTER TABLE "HistoricalMarEntry"
  ADD COLUMN "reconstructionState" "HistoricalMarReconstructionState" NOT NULL DEFAULT 'RECONSTRUCTED',
  ADD COLUMN "medicationAuthorizationState" "HistoricalMedicationAuthorizationState" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "medicationAuthorizationSnapshotJson" JSONB,
  ADD COLUMN "sourceReference" TEXT,
  ADD COLUMN "sourceDescription" TEXT,
  ADD COLUMN "sourceCaregiverSigned" BOOLEAN,
  ADD COLUMN "sourceVerifiedByUserId" TEXT,
  ADD COLUMN "sourceVerifiedAt" TIMESTAMP(3);

ALTER TABLE "HistoricalMarEntry"
  ADD CONSTRAINT "HistoricalMarEntry_sourceVerifiedByUserId_fkey"
  FOREIGN KEY ("sourceVerifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the truth of previously staged exceptions instead of allowing the new
-- default to make them appear authorized.
UPDATE "HistoricalMarEntry"
SET "medicationAuthorizationState" = CASE
  WHEN "matchState" = 'MEDICATION_NOT_APPROVED' THEN 'UNAPPROVED_DRAFT'::"HistoricalMedicationAuthorizationState"
  WHEN "matchState" = 'MEDICATION_HISTORY_GAP' THEN 'HISTORY_UNRESOLVED'::"HistoricalMedicationAuthorizationState"
  ELSE 'APPROVED'::"HistoricalMedicationAuthorizationState"
END;

ALTER TABLE "HistoricalMarAttestation"
  ADD COLUMN "clientId" TEXT,
  ADD COLUMN "reviewerRole" TEXT,
  ADD COLUMN "rangeStart" DATE,
  ADD COLUMN "rangeEnd" DATE,
  ALTER COLUMN "employeeId" DROP NOT NULL;

UPDATE "HistoricalMarAttestation" a
SET "clientId" = b."clientId",
    "rangeStart" = b."rangeStart",
    "rangeEnd" = b."rangeEnd",
    "reviewerRole" = 'LEGACY_CAREGIVER'
FROM "HistoricalMarImportBatch" b
WHERE b."id" = a."batchId";

ALTER TABLE "HistoricalMarAttestation"
  ALTER COLUMN "clientId" SET NOT NULL,
  ALTER COLUMN "reviewerRole" SET NOT NULL,
  ALTER COLUMN "rangeStart" SET NOT NULL,
  ALTER COLUMN "rangeEnd" SET NOT NULL,
  ADD CONSTRAINT "HistoricalMarAttestation_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "HistoricalMarAttestation_organizationId_clientId_rangeStart_idx"
  ON "HistoricalMarAttestation"("organizationId", "clientId", "rangeStart");

INSERT INTO "Permission" ("id", "code", "description", "createdAt") VALUES
  (md5('permission:historical_mar.reconstruct'), 'historical_mar.reconstruct', 'Prepare scheduled historical MAR reconstruction records', CURRENT_TIMESTAMP),
  (md5('permission:historical_mar.review'), 'historical_mar.review', 'Compare reconstructed historical MAR records with authoritative sources', CURRENT_TIMESTAMP),
  (md5('permission:historical_mar.correct'), 'historical_mar.correct', 'Correct previously attested historical MAR records', CURRENT_TIMESTAMP),
  (md5('permission:historical_mar.attest'), 'historical_mar.attest', 'Attest an exact set of source-verified historical MAR records', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Existing medication approvers retain the workflow they already had, now through
-- explicit retrospective permissions. Medication approval itself remains separate.
INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT md5(rp."roleDefinitionId" || ':' || p."id"), rp."roleDefinitionId", p."id", CURRENT_TIMESTAMP
FROM "RolePermission" rp
JOIN "Permission" legacy ON legacy."id" = rp."permissionId" AND legacy."code" = 'medication.approve'
CROSS JOIN "Permission" p
WHERE p."code" IN ('historical_mar.reconstruct', 'historical_mar.review', 'historical_mar.correct', 'historical_mar.attest')
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;

-- Organization managers may prepare drafts but cannot verify, attest, or clinically
-- authorize medication unless separately granted those permissions.
INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT md5(rp."roleDefinitionId" || ':' || p."id"), rp."roleDefinitionId", p."id", CURRENT_TIMESTAMP
FROM "RolePermission" rp
JOIN "Permission" legacy ON legacy."id" = rp."permissionId" AND legacy."code" = 'organization.manage'
CROSS JOIN "Permission" p
WHERE p."code" = 'historical_mar.reconstruct'
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;
