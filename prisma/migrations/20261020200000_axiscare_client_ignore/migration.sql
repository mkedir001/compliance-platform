-- Persist an administrator's explicit decision to exclude a staged AxisCare
-- client without deleting the source mirror, canonical clients, or audit history.
ALTER TABLE "AxisCareRecord"
ADD COLUMN "ignoredAt" TIMESTAMP(3),
ADD COLUMN "ignoredByUserId" TEXT;

CREATE INDEX "AxisCareRecord_organizationId_entity_ignoredAt_idx"
ON "AxisCareRecord"("organizationId", "entity", "ignoredAt");
