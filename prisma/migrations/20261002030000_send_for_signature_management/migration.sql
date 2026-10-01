-- Imported-document provenance is additive and preserves all existing documents.
CREATE TYPE "ClientDocumentSource" AS ENUM ('GENERATED', 'IMPORTED');

ALTER TABLE "ClientDocument"
  ADD COLUMN "source" "ClientDocumentSource" NOT NULL DEFAULT 'GENERATED',
  ADD COLUMN "originalFileName" TEXT,
  ADD COLUMN "sourceDocumentHash" TEXT,
  ADD COLUMN "importedAt" TIMESTAMP(3);
