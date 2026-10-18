CREATE TYPE "ClientImportScope" AS ENUM ('FULL', 'CARE_PROFILE_ONLY');

ALTER TABLE "ClientImportSession" ADD COLUMN "scope" "ClientImportScope" NOT NULL DEFAULT 'FULL';
ALTER TABLE "ClientImportDocument" ADD COLUMN "sourceClientDocumentId" TEXT;
CREATE INDEX "ClientImportDocument_sourceClientDocumentId_idx" ON "ClientImportDocument"("sourceClientDocumentId");
ALTER TABLE "ClientImportDocument" ADD CONSTRAINT "ClientImportDocument_sourceClientDocumentId_fkey" FOREIGN KEY ("sourceClientDocumentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
