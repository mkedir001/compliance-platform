-- AxisCare read-only mirror. No existing rows are changed.
ALTER TABLE "Client" ADD COLUMN "axisCareClientId" TEXT, ADD COLUMN "axisCareServiceStartDate" DATE;
CREATE UNIQUE INDEX "Client_organizationId_axisCareClientId_key" ON "Client"("organizationId", "axisCareClientId");

CREATE TYPE "AxisCareMatchStatus" AS ENUM ('AUTO_LINKED', 'SUGGESTED', 'CONFIRMED', 'REJECTED');

CREATE TABLE "AxisCareWebhookEvent" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "dedupeKey" TEXT NOT NULL, "event" TEXT NOT NULL,
  "entity" TEXT, "action" TEXT, "entityId" TEXT, "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT,
  CONSTRAINT "AxisCareWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AxisCareWebhookEvent_organizationId_dedupeKey_key" ON "AxisCareWebhookEvent"("organizationId", "dedupeKey");
CREATE INDEX "AxisCareWebhookEvent_organizationId_processedAt_receivedAt_idx" ON "AxisCareWebhookEvent"("organizationId", "processedAt", "receivedAt");

CREATE TABLE "AxisCareRecord" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "entity" TEXT NOT NULL, "externalId" TEXT NOT NULL,
  "payload" JSONB NOT NULL, "payloadHash" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "AxisCareRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AxisCareRecord_organizationId_entity_externalId_key" ON "AxisCareRecord"("organizationId", "entity", "externalId");
CREATE INDEX "AxisCareRecord_organizationId_entity_lastSyncedAt_idx" ON "AxisCareRecord"("organizationId", "entity", "lastSyncedAt");

CREATE TABLE "AxisCareVisit" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "externalId" TEXT NOT NULL,
  "axisCareClientId" TEXT, "axisCareCaregiverId" TEXT, "clientId" TEXT,
  "startAt" TIMESTAMP(3), "endAt" TIMESTAMP(3), "scheduledStartAt" TIMESTAMP(3), "scheduledEndAt" TIMESTAMP(3),
  "clockInAt" TIMESTAMP(3), "clockOutAt" TIMESTAMP(3), "clockInMethod" TEXT, "clockOutMethod" TEXT,
  "clockInLatitude" DECIMAL(9,6), "clockInLongitude" DECIMAL(9,6), "clockOutLatitude" DECIMAL(9,6), "clockOutLongitude" DECIMAL(9,6),
  "clockInPhone" TEXT, "clockOutPhone" TEXT,
  "serviceCode" TEXT, "procedureCode" TEXT, "visitType" TEXT, "timezone" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false, "removed" BOOLEAN NOT NULL DEFAULT false,
  "chargeRateCents" INTEGER, "billableRateMode" TEXT, "modificationReason" TEXT,
  "detailPayload" JSONB, "payload" JSONB NOT NULL, "payloadHash" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AxisCareVisit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AxisCareVisit_organizationId_externalId_key" ON "AxisCareVisit"("organizationId", "externalId");
CREATE INDEX "AxisCareVisit_organizationId_clientId_startAt_idx" ON "AxisCareVisit"("organizationId", "clientId", "startAt");
CREATE INDEX "AxisCareVisit_organizationId_axisCareClientId_startAt_idx" ON "AxisCareVisit"("organizationId", "axisCareClientId", "startAt");
CREATE INDEX "AxisCareVisit_organizationId_lastSyncedAt_idx" ON "AxisCareVisit"("organizationId", "lastSyncedAt");
ALTER TABLE "AxisCareVisit" ADD CONSTRAINT "AxisCareVisit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AxisCareClientMatch" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "axisCareClientId" TEXT NOT NULL, "clientId" TEXT,
  "status" "AxisCareMatchStatus" NOT NULL, "score" INTEGER NOT NULL DEFAULT 0, "reason" TEXT NOT NULL,
  "decidedByUserId" TEXT, "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AxisCareClientMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AxisCareClientMatch_organizationId_axisCareClientId_clientId_key" ON "AxisCareClientMatch"("organizationId", "axisCareClientId", "clientId");
CREATE INDEX "AxisCareClientMatch_organizationId_status_idx" ON "AxisCareClientMatch"("organizationId", "status");
ALTER TABLE "AxisCareClientMatch" ADD CONSTRAINT "AxisCareClientMatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AxisCareSyncState" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "entity" TEXT NOT NULL, "cursor" TEXT,
  "lastStartedAt" TIMESTAMP(3), "lastSuccessAt" TIMESTAMP(3), "lastError" TEXT,
  "lastCount" INTEGER NOT NULL DEFAULT 0, "backfillDone" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AxisCareSyncState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AxisCareSyncState_organizationId_entity_key" ON "AxisCareSyncState"("organizationId", "entity");
