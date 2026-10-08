-- Additive document classifications. Existing enum values and records remain unchanged.
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'ADMISSION_FORM';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'RIGHTS_OF_PERSONS_SERVED';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'CSSP';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'CSSP_ADDENDUM';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'CSSP_SIGNATURE_PAGE';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'COUNTY_SUPPORT_PLAN';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'IAPP';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'SMA';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'SMA_SIGNATURE_PAGE';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'SERVICE_AGREEMENT_LETTER';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'SERVICE_AUTHORIZATION';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'OTHER';
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'UNKNOWN';

ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'ADMISSION_FORM';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'RIGHTS_OF_PERSONS_SERVED';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'CSSP';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'CSSP_ADDENDUM';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'CSSP_SIGNATURE_PAGE';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'COUNTY_SUPPORT_PLAN';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'IAPP';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'SMA';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'SMA_SIGNATURE_PAGE';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'SERVICE_AGREEMENT_LETTER';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'SERVICE_AUTHORIZATION';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE TYPE "ClientImportExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'TEXT_EXTRACTED', 'FORM_FIELDS_EXTRACTED', 'OCR_REQUIRED', 'OCR_COMPLETED', 'NO_USEFUL_FIELDS', 'EXTRACTION_FAILED');
CREATE TYPE "ClientImportClassificationReviewStatus" AS ENUM ('UNREVIEWED', 'AUTOMATIC', 'MANUAL');

ALTER TABLE "ClientDocument"
  ADD COLUMN "originalMimeType" TEXT,
  ADD COLUMN "originalFileSize" INTEGER,
  ADD COLUMN "classificationDescription" TEXT;

ALTER TABLE "ClientImportSession"
  ADD COLUMN "processingFailures" JSONB;

ALTER TABLE "ClientImportDocument"
  ADD COLUMN "classificationDescription" TEXT,
  ADD COLUMN "classificationReviewStatus" "ClientImportClassificationReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
  ADD COLUMN "extractionStatus" "ClientImportExtractionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "fileSize" INTEGER,
  ADD COLUMN "extractedData" JSONB;

UPDATE "ClientImportDocument"
SET "fileSize" = octet_length("originalBytes")
WHERE "fileSize" IS NULL;

UPDATE "ClientImportDocument"
SET "classificationReviewStatus" = CASE WHEN "classification" = 'UNKNOWN' THEN 'UNREVIEWED'::"ClientImportClassificationReviewStatus" ELSE 'AUTOMATIC'::"ClientImportClassificationReviewStatus" END,
    "extractionStatus" = CASE
      WHEN "ocrRequired" THEN 'OCR_REQUIRED'::"ClientImportExtractionStatus"
      WHEN "extractionMethod" = 'PDF_FORM_FIELD' THEN 'FORM_FIELDS_EXTRACTED'::"ClientImportExtractionStatus"
      WHEN "extractionMethod" = 'NATIVE_TEXT' THEN 'TEXT_EXTRACTED'::"ClientImportExtractionStatus"
      ELSE 'NO_USEFUL_FIELDS'::"ClientImportExtractionStatus"
    END;

ALTER TABLE "ClientImportProposal"
  ALTER COLUMN "documentId" DROP NOT NULL;
