-- Add explicit, organization-scoped test-data markings. Existing records remain unmarked.
ALTER TABLE "Client"
  ADD COLUMN "testDataMarkedAt" TIMESTAMP(3),
  ADD COLUMN "testDataMarkedByUserId" TEXT,
  ADD COLUMN "testDataReason" TEXT;

ALTER TABLE "Employee"
  ADD COLUMN "testDataMarkedAt" TIMESTAMP(3),
  ADD COLUMN "testDataMarkedByUserId" TEXT,
  ADD COLUMN "testDataReason" TEXT;

CREATE TYPE "TestDataCleanupPreviewStatus" AS ENUM ('READY', 'EXECUTED', 'EXPIRED', 'STALE');

CREATE TABLE "TestDataCleanupPreview" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" "TestDataCleanupPreviewStatus" NOT NULL DEFAULT 'READY',
  "selectionHash" TEXT NOT NULL,
  "selectionJson" JSONB NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "resultJson" JSONB,
  "idempotencyKey" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TestDataCleanupPreview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestDataCleanupPreview_idempotencyKey_key" ON "TestDataCleanupPreview"("idempotencyKey");
CREATE INDEX "TestDataCleanupPreview_organizationId_status_expiresAt_idx" ON "TestDataCleanupPreview"("organizationId", "status", "expiresAt");
CREATE INDEX "TestDataCleanupPreview_organizationId_requestedByUserId_createdAt_idx" ON "TestDataCleanupPreview"("organizationId", "requestedByUserId", "createdAt");
ALTER TABLE "TestDataCleanupPreview" ADD CONSTRAINT "TestDataCleanupPreview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
