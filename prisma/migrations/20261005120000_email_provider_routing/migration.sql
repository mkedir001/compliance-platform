-- Persist provider attempts without retaining recipients, bodies, tokens, or signing URLs.
CREATE TYPE "EmailCommunicationPurpose" AS ENUM ('CLIENT_SECURE', 'WORKFORCE_TRANSACTIONAL');
CREATE TYPE "EmailTransportState" AS ENUM ('PENDING', 'PROVIDER_ACCEPTED', 'FAILED', 'AMBIGUOUS');
CREATE TYPE "EmailProviderAttemptOutcome" AS ENUM ('ACCEPTED', 'FAILED');

CREATE TABLE "EmailCommunication" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "purpose" "EmailCommunicationPurpose" NOT NULL,
  "logicalType" TEXT NOT NULL,
  "logicalId" TEXT NOT NULL,
  "state" "EmailTransportState" NOT NULL DEFAULT 'PENDING',
  "selectedProvider" TEXT,
  "providerMessageId" TEXT,
  "providerAcceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailCommunication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailProviderAttempt" (
  "id" TEXT NOT NULL,
  "communicationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "outcome" "EmailProviderAttemptOutcome" NOT NULL,
  "failureClassification" TEXT,
  "errorCode" TEXT,
  "providerMessageId" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailProviderAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailCommunication_organizationId_purpose_logicalType_logicalId_key" ON "EmailCommunication"("organizationId", "purpose", "logicalType", "logicalId");
CREATE INDEX "EmailCommunication_organizationId_purpose_state_createdAt_idx" ON "EmailCommunication"("organizationId", "purpose", "state", "createdAt");
CREATE INDEX "EmailCommunication_selectedProvider_providerMessageId_idx" ON "EmailCommunication"("selectedProvider", "providerMessageId");
CREATE UNIQUE INDEX "EmailProviderAttempt_communicationId_sequence_key" ON "EmailProviderAttempt"("communicationId", "sequence");
CREATE INDEX "EmailProviderAttempt_provider_providerMessageId_idx" ON "EmailProviderAttempt"("provider", "providerMessageId");
ALTER TABLE "EmailCommunication" ADD CONSTRAINT "EmailCommunication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailProviderAttempt" ADD CONSTRAINT "EmailProviderAttempt_communicationId_fkey" FOREIGN KEY ("communicationId") REFERENCES "EmailCommunication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
