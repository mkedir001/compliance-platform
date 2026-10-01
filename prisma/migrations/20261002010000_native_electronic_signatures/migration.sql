-- Native signing is additive. Existing provider envelopes and finalized documents remain unchanged.
CREATE TYPE "SignatureMethod" AS ENUM ('TYPED', 'DRAWN');
CREATE TYPE "SignerVerificationMethod" AS ENUM ('IN_PERSON_FACILITATED', 'SECURE_INVITATION', 'AUTHENTICATED_USER');
CREATE TYPE "SignatureInvitationStatus" AS ENUM ('ACTIVE', 'USED', 'REVOKED', 'EXPIRED');

ALTER TABLE "SignatureEnvelope"
  ADD COLUMN "frozenPdf" BYTEA,
  ADD COLUMN "frozenDocumentHash" TEXT,
  ADD COLUMN "finalDocumentHash" TEXT,
  ADD COLUMN "consentVersion" TEXT NOT NULL DEFAULT 'native-esign-consent-v1',
  ADD COLUMN "evidenceJson" JSONB,
  ADD COLUMN "evidencePdf" BYTEA,
  ADD COLUMN "voidReason" TEXT;

ALTER TABLE "SignatureSigner"
  ADD COLUMN "signatureMethod" "SignatureMethod",
  ADD COLUMN "adoptedName" TEXT,
  ADD COLUMN "signatureData" BYTEA,
  ADD COLUMN "consentVersion" TEXT,
  ADD COLUMN "consentedAt" TIMESTAMP(3),
  ADD COLUMN "verificationMethod" "SignerVerificationMethod",
  ADD COLUMN "facilitatorUserId" TEXT;

CREATE TABLE "SignatureInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "signerId" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "status" "SignatureInvitationStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "replacedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignatureInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureInvitation_tokenDigest_key" ON "SignatureInvitation"("tokenDigest");
CREATE UNIQUE INDEX "SignatureInvitation_replacedById_key" ON "SignatureInvitation"("replacedById");
CREATE INDEX "SignatureInvitation_organizationId_envelopeId_signerId_status_idx" ON "SignatureInvitation"("organizationId", "envelopeId", "signerId", "status");
CREATE INDEX "SignatureInvitation_expiresAt_status_idx" ON "SignatureInvitation"("expiresAt", "status");
ALTER TABLE "SignatureInvitation" ADD CONSTRAINT "SignatureInvitation_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureInvitation" ADD CONSTRAINT "SignatureInvitation_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "SignatureSigner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureInvitation" ADD CONSTRAINT "SignatureInvitation_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "SignatureInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
