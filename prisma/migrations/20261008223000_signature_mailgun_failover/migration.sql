CREATE TYPE "EmailProviderAttemptDecision" AS ENUM ('ACCEPTED', 'RETRY_PRIMARY', 'FAILOVER', 'STOPPED');

ALTER TABLE "EmailProviderAttempt"
  ADD COLUMN "decision" "EmailProviderAttemptDecision";

UPDATE "EmailProviderAttempt"
SET "decision" = CASE
  WHEN "outcome" = 'ACCEPTED' THEN 'ACCEPTED'::"EmailProviderAttemptDecision"
  ELSE 'STOPPED'::"EmailProviderAttemptDecision"
END
WHERE "decision" IS NULL;
