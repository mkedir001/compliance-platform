-- Add versioned renewal policy and immutable renewal lineage without changing
-- historical document bytes, snapshots, signatures, or template associations.
CREATE TYPE "ClientDocumentRenewalPolicy" AS ENUM ('NONE', 'ANNUAL', 'EXPIRATION_DATE_DRIVEN');

ALTER TABLE "ClientDocumentTemplate"
  ADD COLUMN "renewalPolicy" "ClientDocumentRenewalPolicy" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "renewalWarningDays" INTEGER NOT NULL DEFAULT 30,
  ADD CONSTRAINT "ClientDocumentTemplate_renewalWarningDays_check" CHECK ("renewalWarningDays" BETWEEN 0 AND 3650);

ALTER TABLE "ClientDocument"
  ADD COLUMN "authoritativeCompletedAt" TIMESTAMP(3),
  ADD COLUMN "renewalOfDocumentId" TEXT;

-- Preserve the actual envelope completion instant for already-completed signed
-- documents. No inferred date is written for documents lacking this evidence.
UPDATE "ClientDocument" d
SET "authoritativeCompletedAt" = e."completedAt"
FROM "SignatureEnvelope" e
WHERE e."documentId" = d."id"
  AND d."status" = 'COMPLETED'
  AND e."status" = 'COMPLETED'
  AND e."completedAt" IS NOT NULL;

UPDATE "ClientDocumentTemplate"
SET "renewalPolicy" = 'ANNUAL', "renewalWarningDays" = 30
WHERE "code" = '02-RIGHTS'
  AND "documentType" = 'RIGHTS_ACKNOWLEDGMENT'
  AND "contentJson"->>'renderer' = 'RADIANT_CARE_ACROFORM_V1'
  AND "status" = 'ACTIVE';

UPDATE "ClientDocumentTemplate"
SET "renewalPolicy" = 'EXPIRATION_DATE_DRIVEN', "renewalWarningDays" = 30
WHERE "code" = '04-ROI'
  AND "documentType" = 'ROI'
  AND "contentJson"->>'renderer' = 'RADIANT_CARE_ACROFORM_V1'
  AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "ClientDocument_renewalOfDocumentId_key" ON "ClientDocument"("renewalOfDocumentId");
CREATE INDEX "ClientDocument_organizationId_clientId_authoritativeCompletedAt_idx"
  ON "ClientDocument"("organizationId", "clientId", "authoritativeCompletedAt");

ALTER TABLE "ClientDocument"
  ADD CONSTRAINT "ClientDocument_renewalOfDocumentId_fkey"
  FOREIGN KEY ("renewalOfDocumentId") REFERENCES "ClientDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
