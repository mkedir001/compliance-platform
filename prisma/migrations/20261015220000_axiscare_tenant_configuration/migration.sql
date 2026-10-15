-- Tenant-specific AxisCare configuration and explicit caregiver/service mappings.
-- All changes are additive; credentials are stored only as authenticated ciphertext.
CREATE TYPE "AxisCareConnectionStatus" AS ENUM ('CONFIGURATION_INCOMPLETE', 'CONNECTED', 'AUTHENTICATION_FAILED', 'CONNECTION_UNAVAILABLE');

CREATE TABLE "AxisCareConnection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "encryptedApiToken" TEXT NOT NULL,
  "tokenFingerprint" TEXT NOT NULL,
  "historyMonths" INTEGER NOT NULL DEFAULT 12,
  "extraEntities" TEXT NOT NULL DEFAULT '',
  "status" "AxisCareConnectionStatus" NOT NULL DEFAULT 'CONFIGURATION_INCOMPLETE',
  "lastTestedAt" TIMESTAMP(3),
  "lastConnectedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AxisCareConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AxisCareConnection_organizationId_key" ON "AxisCareConnection"("organizationId");
CREATE INDEX "AxisCareConnection_status_idx" ON "AxisCareConnection"("status");
ALTER TABLE "AxisCareConnection" ADD CONSTRAINT "AxisCareConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Employee" ADD COLUMN "axisCareCaregiverId" TEXT;
CREATE UNIQUE INDEX "Employee_organizationId_axisCareCaregiverId_key" ON "Employee"("organizationId", "axisCareCaregiverId");

ALTER TABLE "AxisCareVisit" ADD COLUMN "employeeId" TEXT;
CREATE INDEX "AxisCareVisit_organizationId_employeeId_startAt_idx" ON "AxisCareVisit"("organizationId", "employeeId", "startAt");
ALTER TABLE "AxisCareVisit" ADD CONSTRAINT "AxisCareVisit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AxisCareServiceMapping" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "axisCareServiceCode" TEXT NOT NULL,
  "waldahServiceType" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AxisCareServiceMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AxisCareServiceMapping_organizationId_axisCareServiceCode_key" ON "AxisCareServiceMapping"("organizationId", "axisCareServiceCode");
CREATE INDEX "AxisCareServiceMapping_organizationId_waldahServiceType_idx" ON "AxisCareServiceMapping"("organizationId", "waldahServiceType");
ALTER TABLE "AxisCareServiceMapping" ADD CONSTRAINT "AxisCareServiceMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The initial integration tables were intentionally empty before activation. Add tenant FKs now.
ALTER TABLE "AxisCareWebhookEvent" ADD CONSTRAINT "AxisCareWebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AxisCareRecord" ADD CONSTRAINT "AxisCareRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AxisCareVisit" ADD CONSTRAINT "AxisCareVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AxisCareClientMatch" ADD CONSTRAINT "AxisCareClientMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AxisCareSyncState" ADD CONSTRAINT "AxisCareSyncState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
