-- PostgreSQL requires newly added enum values to commit before later statements use them.
ALTER TYPE "ClientDocumentType" ADD VALUE IF NOT EXISTS 'REFERRAL_FORM';
ALTER TYPE "ClientImportClassification" ADD VALUE IF NOT EXISTS 'REFERRAL_FORM';
