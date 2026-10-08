-- Persist import-review document settings so a review can be safely resumed.
ALTER TABLE "ClientImportDocument" ADD COLUMN "reviewedCompletedAt" TIMESTAMP(3);
