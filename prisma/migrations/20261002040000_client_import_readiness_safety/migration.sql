-- Durable import review is additive. Existing clients, documents, signatures, and readiness evidence are unchanged.
CREATE TYPE "ClientImportStatus" AS ENUM ('REVIEW_REQUIRED', 'CONFIRMED', 'CANCELED');
CREATE TYPE "ClientImportDocumentStatus" AS ENUM ('EXTRACTED', 'OCR_REQUIRED', 'REVIEW_REQUIRED', 'ACCEPTED', 'REJECTED');
CREATE TYPE "ClientImportClassification" AS ENUM ('INTAKE_CHECKLIST', 'FACE_SHEET', 'RIGHTS_ACKNOWLEDGMENT', 'ROI', 'UNKNOWN');
CREATE TYPE "ClientImportExtractionMethod" AS ENUM ('PDF_FORM_FIELD', 'NATIVE_TEXT', 'KNOWN_TEMPLATE', 'MANUAL', 'DOCUMENT_AI');
CREATE TYPE "ClientImportProposalState" AS ENUM ('PROPOSED', 'CORROBORATED', 'CONFLICT', 'ACCEPTED', 'CORRECTED', 'REJECTED');
CREATE TYPE "ClientImportTarget" AS ENUM ('CREATE_NEW', 'UPDATE_EXISTING');
CREATE TYPE "ClientImportDocumentDisposition" AS ENUM ('PRESERVE_ONLY', 'HISTORICAL_COMPLETE', 'CURRENT_SIGNATURE_REQUIRED');

CREATE TABLE "ClientImportSession" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "existingClientId" TEXT,
  "target" "ClientImportTarget" NOT NULL,
  "status" "ClientImportStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "confirmedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientImportSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientImportDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalBytes" BYTEA NOT NULL,
  "sha256" TEXT NOT NULL,
  "classification" "ClientImportClassification" NOT NULL DEFAULT 'UNKNOWN',
  "status" "ClientImportDocumentStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "extractionMethod" "ClientImportExtractionMethod",
  "pageCount" INTEGER NOT NULL,
  "ocrRequired" BOOLEAN NOT NULL DEFAULT false,
  "extractedText" TEXT,
  "classificationSignals" JSONB,
  "disposition" "ClientImportDocumentDisposition" NOT NULL DEFAULT 'PRESERVE_ONLY',
  "confirmedDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientImportDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientImportProposal" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "fieldPath" TEXT NOT NULL,
  "proposedValue" JSONB NOT NULL,
  "correctedValue" JSONB,
  "sourceLocation" TEXT,
  "extractionMethod" "ClientImportExtractionMethod" NOT NULL,
  "confidence" DOUBLE PRECISION,
  "state" "ClientImportProposalState" NOT NULL DEFAULT 'PROPOSED',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientImportProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientImportSession_organizationId_status_createdAt_idx" ON "ClientImportSession"("organizationId", "status", "createdAt");
CREATE INDEX "ClientImportSession_organizationId_existingClientId_idx" ON "ClientImportSession"("organizationId", "existingClientId");
CREATE UNIQUE INDEX "ClientImportDocument_sessionId_sha256_key" ON "ClientImportDocument"("sessionId", "sha256");
CREATE UNIQUE INDEX "ClientImportDocument_confirmedDocumentId_key" ON "ClientImportDocument"("confirmedDocumentId");
CREATE INDEX "ClientImportDocument_organizationId_sessionId_classification_idx" ON "ClientImportDocument"("organizationId", "sessionId", "classification");
CREATE INDEX "ClientImportProposal_organizationId_sessionId_fieldPath_idx" ON "ClientImportProposal"("organizationId", "sessionId", "fieldPath");
CREATE INDEX "ClientImportProposal_documentId_idx" ON "ClientImportProposal"("documentId");

ALTER TABLE "ClientImportSession" ADD CONSTRAINT "ClientImportSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportSession" ADD CONSTRAINT "ClientImportSession_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportSession" ADD CONSTRAINT "ClientImportSession_existingClientId_fkey" FOREIGN KEY ("existingClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportDocument" ADD CONSTRAINT "ClientImportDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportDocument" ADD CONSTRAINT "ClientImportDocument_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClientImportSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportDocument" ADD CONSTRAINT "ClientImportDocument_confirmedDocumentId_fkey" FOREIGN KEY ("confirmedDocumentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportProposal" ADD CONSTRAINT "ClientImportProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportProposal" ADD CONSTRAINT "ClientImportProposal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClientImportSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportProposal" ADD CONSTRAINT "ClientImportProposal_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ClientImportDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientImportProposal" ADD CONSTRAINT "ClientImportProposal_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
