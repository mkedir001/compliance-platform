-- Additive policy-library metadata and immutable source-document storage.
ALTER TABLE "Policy" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL';

ALTER TABLE "PolicyVersion"
  ADD COLUMN "versionLabel" TEXT,
  ADD COLUMN "originalFileName" TEXT,
  ADD COLUMN "originalMimeType" TEXT,
  ADD COLUMN "originalFileSize" INTEGER,
  ADD COLUMN "originalDocument" BYTEA,
  ADD COLUMN "publishedByUserId" TEXT;

ALTER TABLE "PolicyVersion"
  ADD CONSTRAINT "PolicyVersion_publishedByUserId_fkey"
  FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Policy_organizationId_category_status_idx" ON "Policy"("organizationId", "category", "status");
CREATE UNIQUE INDEX "PolicyVersion_policyId_versionLabel_key" ON "PolicyVersion"("policyId", "versionLabel");
