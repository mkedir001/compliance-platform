ALTER TABLE "SignatureEnvelope" ADD COLUMN "currentRenditionId" TEXT;

ALTER TABLE "SignatureSigner"
  ADD COLUMN "reviewedRenditionId" TEXT,
  ADD COLUMN "reviewedRenditionHash" TEXT,
  ADD COLUMN "resultingRenditionId" TEXT,
  ADD COLUMN "resultingRenditionHash" TEXT;

ALTER TABLE "SignatureInvitation"
  ADD COLUMN "reviewedRenditionId" TEXT,
  ADD COLUMN "reviewedRenditionHash" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "pendingSignatureMethod" "SignatureMethod",
  ADD COLUMN "pendingAdoptedName" TEXT,
  ADD COLUMN "pendingSignatureData" BYTEA,
  ADD COLUMN "pendingConsentVersion" TEXT,
  ADD COLUMN "pendingConsentedAt" TIMESTAMP(3),
  ADD COLUMN "pendingReviewedRenditionId" TEXT,
  ADD COLUMN "pendingReviewedRenditionHash" TEXT;

CREATE TABLE "SignatureRendition" (
  "id" TEXT NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "previousRenditionId" TEXT,
  "signerId" TEXT,
  "pdf" BYTEA NOT NULL,
  "renditionHash" TEXT NOT NULL,
  "sourceContentHash" TEXT NOT NULL,
  "reviewedRenditionId" TEXT,
  "reviewedRenditionHash" TEXT,
  "verificationMethod" "SignerVerificationMethod",
  "acceptedAt" TIMESTAMP(3),
  "isFinal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignatureRendition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureEnvelope_currentRenditionId_key" ON "SignatureEnvelope"("currentRenditionId");
CREATE UNIQUE INDEX "SignatureRendition_envelopeId_sequence_key" ON "SignatureRendition"("envelopeId", "sequence");
CREATE UNIQUE INDEX "SignatureRendition_envelopeId_signerId_key" ON "SignatureRendition"("envelopeId", "signerId");
CREATE INDEX "SignatureRendition_previousRenditionId_idx" ON "SignatureRendition"("previousRenditionId");
CREATE INDEX "SignatureRendition_envelopeId_isFinal_idx" ON "SignatureRendition"("envelopeId", "isFinal");

ALTER TABLE "SignatureRendition" ADD CONSTRAINT "SignatureRendition_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureRendition" ADD CONSTRAINT "SignatureRendition_previousRenditionId_fkey" FOREIGN KEY ("previousRenditionId") REFERENCES "SignatureRendition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_currentRenditionId_fkey" FOREIGN KEY ("currentRenditionId") REFERENCES "SignatureRendition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "SignatureRendition" ("id", "envelopeId", "sequence", "pdf", "renditionHash", "sourceContentHash", "createdAt")
SELECT 'legacy-r0-' || e."id", e."id", 0, e."frozenPdf", e."frozenDocumentHash", e."frozenDocumentHash", e."createdAt"
FROM "SignatureEnvelope" e
WHERE e."frozenPdf" IS NOT NULL AND e."frozenDocumentHash" IS NOT NULL;

INSERT INTO "SignatureRendition" ("id", "envelopeId", "sequence", "previousRenditionId", "pdf", "renditionHash", "sourceContentHash", "acceptedAt", "isFinal", "createdAt")
SELECT 'legacy-final-' || e."id", e."id", 1, 'legacy-r0-' || e."id", d."finalPdf", e."finalDocumentHash", e."frozenDocumentHash", e."completedAt", true, COALESCE(e."completedAt", e."updatedAt")
FROM "SignatureEnvelope" e
JOIN "ClientDocument" d ON d."id" = e."documentId"
WHERE e."status" = 'COMPLETED'
  AND e."frozenPdf" IS NOT NULL
  AND e."frozenDocumentHash" IS NOT NULL
  AND e."finalDocumentHash" IS NOT NULL
  AND d."finalPdf" IS NOT NULL;

UPDATE "SignatureEnvelope" e
SET "currentRenditionId" = COALESCE(
  (SELECT r."id" FROM "SignatureRendition" r WHERE r."envelopeId" = e."id" AND r."isFinal" = true LIMIT 1),
  (SELECT r."id" FROM "SignatureRendition" r WHERE r."envelopeId" = e."id" AND r."sequence" = 0 LIMIT 1)
);
