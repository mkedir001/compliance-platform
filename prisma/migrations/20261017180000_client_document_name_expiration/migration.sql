-- Per-document display name and manual expiration date. Both are optional metadata; stored PDFs are never changed.
ALTER TABLE "ClientDocument" ADD COLUMN "displayName" TEXT;
ALTER TABLE "ClientDocument" ADD COLUMN "expirationDate" DATE;
