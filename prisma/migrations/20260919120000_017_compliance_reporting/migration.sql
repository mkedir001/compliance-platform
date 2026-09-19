ALTER TABLE "AuditPackage"
  ADD COLUMN "rangeFrom" TIMESTAMP(3),
  ADD COLUMN "rangeTo" TIMESTAMP(3),
  ADD COLUMN "includedDomains" JSONB,
  ADD COLUMN "reportVersion" TEXT DEFAULT 'phase22-v1',
  ADD COLUMN "recordCount" INTEGER;

CREATE INDEX "AuditPackage_organizationId_generatedAt_idx" ON "AuditPackage"("organizationId", "generatedAt");
