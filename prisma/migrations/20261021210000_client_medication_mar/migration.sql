-- Medication administration record (MAR): per-dose entries, stored staff signatures, weekly sign-offs, and an
-- administrator-only edit history.
CREATE TYPE "MedicationDoseStatus" AS ENUM ('GIVEN', 'REFUSED', 'HELD', 'NOT_GIVEN');

ALTER TABLE "ClientMedication"
ADD COLUMN "route" TEXT,
ADD COLUMN "startDate" DATE,
ADD COLUMN "stopDate" DATE;

CREATE TABLE "MedicationStaffSignature" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "typedName" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MedicationStaffSignature_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MedicationStaffSignature_organizationId_userId_key" ON "MedicationStaffSignature"("organizationId", "userId");
CREATE UNIQUE INDEX "MedicationStaffSignature_organizationId_initials_key" ON "MedicationStaffSignature"("organizationId", "initials");

CREATE TABLE "ClientMedicationDose" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "doseDate" DATE NOT NULL,
    "scheduledTime" TEXT NOT NULL,
    "status" "MedicationDoseStatus" NOT NULL,
    "timeGiven" TEXT,
    "note" TEXT,
    "signerUserId" TEXT,
    "signerName" TEXT,
    "signerInitials" TEXT,
    "appliedByUserId" TEXT NOT NULL,
    "attestedInPerson" BOOLEAN NOT NULL DEFAULT false,
    "transferredFromPaper" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientMedicationDose_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientMedicationDose_medicationId_doseDate_scheduledTime_key" ON "ClientMedicationDose"("medicationId", "doseDate", "scheduledTime");
CREATE INDEX "ClientMedicationDose_organizationId_clientId_doseDate_idx" ON "ClientMedicationDose"("organizationId", "clientId", "doseDate");
ALTER TABLE "ClientMedicationDose" ADD CONSTRAINT "ClientMedicationDose_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "ClientMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClientMedicationWeekSignoff" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "appliedByUserId" TEXT NOT NULL,
    "attestedInPerson" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientMedicationWeekSignoff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientMedicationWeekSignoff_clientId_weekStart_key" ON "ClientMedicationWeekSignoff"("clientId", "weekStart");
CREATE INDEX "ClientMedicationWeekSignoff_organizationId_clientId_idx" ON "ClientMedicationWeekSignoff"("organizationId", "clientId");

CREATE TABLE "ClientMedicationHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientMedicationHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientMedicationHistory_organizationId_clientId_changedAt_idx" ON "ClientMedicationHistory"("organizationId", "clientId", "changedAt");
CREATE INDEX "ClientMedicationHistory_entityType_entityId_idx" ON "ClientMedicationHistory"("entityType", "entityId");
