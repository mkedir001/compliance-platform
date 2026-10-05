CREATE TYPE "EmailDeliveryState" AS ENUM ('NOT_CONFIRMED', 'DELIVERED', 'DEFERRED', 'BOUNCED', 'COMPLAINED');

ALTER TYPE "EmployeePortalInvitationDeliveryStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "EmployeePortalInvitationDeliveryStatus" ADD VALUE 'DEFERRED';
ALTER TYPE "EmployeePortalInvitationDeliveryStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "EmployeePortalInvitationDeliveryStatus" ADD VALUE 'COMPLAINED';

ALTER TABLE "EmployeePortalInvitation"
  ADD COLUMN "deliveryUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3);

ALTER TABLE "EmailCommunication"
  ADD COLUMN "deliveryState" "EmailDeliveryState" NOT NULL DEFAULT 'NOT_CONFIRMED',
  ADD COLUMN "deliveryUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "deliveryErrorCode" TEXT;

ALTER TABLE "EmailProviderAttempt"
  ADD COLUMN "deliveryState" "EmailDeliveryState" NOT NULL DEFAULT 'NOT_CONFIRMED',
  ADD COLUMN "deliveryUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "deliveryErrorCode" TEXT;

CREATE TABLE "EmailProviderEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "communicationId" TEXT NOT NULL,
  "providerAttemptId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "signatureTokenHash" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "deliveryState" "EmailDeliveryState" NOT NULL,
  "providerTimestamp" TIMESTAMP(3) NOT NULL,
  "errorCode" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailProviderEvent_provider_providerEventId_key" ON "EmailProviderEvent"("provider", "providerEventId");
CREATE UNIQUE INDEX "EmailProviderEvent_provider_signatureTokenHash_key" ON "EmailProviderEvent"("provider", "signatureTokenHash");
CREATE INDEX "EmailProviderEvent_organizationId_createdAt_idx" ON "EmailProviderEvent"("organizationId", "createdAt");
CREATE INDEX "EmailProviderEvent_communicationId_providerTimestamp_idx" ON "EmailProviderEvent"("communicationId", "providerTimestamp");

ALTER TABLE "EmailProviderEvent" ADD CONSTRAINT "EmailProviderEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailProviderEvent" ADD CONSTRAINT "EmailProviderEvent_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "EmailCommunication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailProviderEvent" ADD CONSTRAINT "EmailProviderEvent_providerAttemptId_fkey" FOREIGN KEY ("providerAttemptId") REFERENCES "EmailProviderAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
