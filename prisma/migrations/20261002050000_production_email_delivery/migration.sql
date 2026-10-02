-- Additive delivery-attempt state keeps transport acceptance separate from invitation and signature lifecycle.
CREATE TYPE "SignatureInvitationDeliveryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'FAILED');

ALTER TABLE "SignatureInvitation"
  ADD COLUMN "deliveryStatus" "SignatureInvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryErrorCode" TEXT,
  ADD COLUMN "providerMessageId" TEXT;

UPDATE "SignatureInvitation"
SET
  "deliveryStatus" = 'ACCEPTED',
  "deliveryAttempts" = 1,
  "deliveryAttemptedAt" = "deliveredAt"
WHERE "deliveredAt" IS NOT NULL;

CREATE INDEX "SignatureInvitation_organizationId_deliveryStatus_deliveryAttemptedAt_idx"
  ON "SignatureInvitation"("organizationId", "deliveryStatus", "deliveryAttemptedAt");
