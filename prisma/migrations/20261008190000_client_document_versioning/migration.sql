-- Add explicit, immutable lineage for generated document revisions. Existing
-- records remain version 1; future replacements point to the exact version
-- they supersede. No existing bytes, statuses, or signature evidence change.
ALTER TABLE "ClientDocument"
  ADD COLUMN "versionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "supersedesDocumentId" TEXT,
  ADD COLUMN "sourceDataOutdatedAt" TIMESTAMP(3);

CREATE INDEX "ClientDocument_supersedesDocumentId_idx"
  ON "ClientDocument"("supersedesDocumentId");

CREATE INDEX "ClientDocument_organizationId_clientId_documentType_versionNumber_idx"
  ON "ClientDocument"("organizationId", "clientId", "documentType", "versionNumber");

ALTER TABLE "ClientDocument"
  ADD CONSTRAINT "ClientDocument_supersedesDocumentId_fkey"
  FOREIGN KEY ("supersedesDocumentId") REFERENCES "ClientDocument"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
