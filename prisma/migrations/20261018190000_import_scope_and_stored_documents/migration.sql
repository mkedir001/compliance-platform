ALTER TABLE "ClientImportSession" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'FULL';
ALTER TABLE "ClientImportDocument" ADD COLUMN "sourceClientDocumentId" TEXT;
CREATE INDEX "ClientImportDocument_sourceClientDocumentId_idx" ON "ClientImportDocument"("sourceClientDocumentId");
