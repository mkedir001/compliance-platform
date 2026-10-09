-- Additive extraction provenance for the PHI-safe, container-local OCR engine.
-- Existing import records and original document objects are not modified.
ALTER TYPE "ClientImportExtractionMethod" ADD VALUE IF NOT EXISTS 'LOCAL_OCR';
