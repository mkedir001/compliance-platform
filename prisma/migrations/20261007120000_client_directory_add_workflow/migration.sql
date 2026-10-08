-- Date of birth is collected during intake when it is not known at initial creation.
ALTER TABLE "Client" ALTER COLUMN "dateOfBirth" DROP NOT NULL;

-- Durable request keys make retries after an ambiguous response idempotent.
ALTER TABLE "Client" ADD COLUMN "creationRequestId" TEXT;
ALTER TABLE "ClientImportSession" ADD COLUMN "creationRequestId" TEXT;

CREATE UNIQUE INDEX "Client_organizationId_creationRequestId_key"
ON "Client"("organizationId", "creationRequestId");

CREATE UNIQUE INDEX "ClientImportSession_organizationId_creationRequestId_key"
ON "ClientImportSession"("organizationId", "creationRequestId");
