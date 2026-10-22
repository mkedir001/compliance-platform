-- CreateEnum
CREATE TYPE "HistoricalMarImportBatchStatus" AS ENUM ('STAGED', 'IN_REVIEW', 'COMPLETED', 'COMPLETED_WITH_EXCEPTIONS');

-- CreateEnum
CREATE TYPE "HistoricalMarMatchState" AS ENUM ('MATCHED', 'AMBIGUOUS_VISIT', 'NO_ACTUAL_VISIT', 'MISSING_CLOCK_IN', 'MISSING_CLOCK_OUT', 'MISSING_CAREGIVER_MAPPING', 'MEDICATION_HISTORY_GAP', 'MEDICATION_NOT_APPROVED', 'EXISTING_MAR_ENTRY');

-- CreateEnum
CREATE TYPE "HistoricalMarReviewState" AS ENUM ('AWAITING_CAREGIVER_REVIEW', 'READY_TO_ATTEST', 'FLAGGED_FOR_CORRECTION', 'ATTESTED');

-- CreateTable
CREATE TABLE "HistoricalMarImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rangeStart" DATE NOT NULL,
    "rangeEnd" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'AXISCARE_VISITS',
    "sourceQueryJson" JSONB NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "status" "HistoricalMarImportBatchStatus" NOT NULL DEFAULT 'STAGED',
    "summaryJson" JSONB NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalMarImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalMarEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "axisCareVisitId" TEXT,
    "employeeId" TEXT,
    "doseDate" DATE NOT NULL,
    "scheduledTime" TEXT NOT NULL,
    "stableSourceKey" TEXT NOT NULL,
    "matchState" "HistoricalMarMatchState" NOT NULL,
    "confidence" TEXT NOT NULL,
    "sourceSnapshotJson" JSONB NOT NULL,
    "reviewState" "HistoricalMarReviewState" NOT NULL DEFAULT 'AWAITING_CAREGIVER_REVIEW',
    "paperStatus" "MedicationDoseStatus",
    "paperTimeGiven" TEXT,
    "paperNote" TEXT,
    "discrepancyCode" TEXT,
    "discrepancyNote" TEXT,
    "correctionReason" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "attestationId" TEXT,
    "finalizedDoseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalMarEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalMarAttestation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "medicationSignatureId" TEXT NOT NULL,
    "entryIdsJson" JSONB NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "statementVersion" TEXT NOT NULL,
    "statementSnapshot" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalMarAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricalMarImportBatch_organizationId_clientId_createdAt_idx" ON "HistoricalMarImportBatch"("organizationId", "clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalMarImportBatch_organizationId_sourceFingerprint_key" ON "HistoricalMarImportBatch"("organizationId", "sourceFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalMarEntry_finalizedDoseId_key" ON "HistoricalMarEntry"("finalizedDoseId");

-- CreateIndex
CREATE INDEX "HistoricalMarEntry_organizationId_employeeId_reviewState_do_idx" ON "HistoricalMarEntry"("organizationId", "employeeId", "reviewState", "doseDate");

-- CreateIndex
CREATE INDEX "HistoricalMarEntry_organizationId_clientId_doseDate_idx" ON "HistoricalMarEntry"("organizationId", "clientId", "doseDate");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalMarEntry_organizationId_stableSourceKey_key" ON "HistoricalMarEntry"("organizationId", "stableSourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalMarEntry_batchId_medicationId_doseDate_scheduledT_key" ON "HistoricalMarEntry"("batchId", "medicationId", "doseDate", "scheduledTime");

-- CreateIndex
CREATE INDEX "HistoricalMarAttestation_organizationId_employeeId_signedAt_idx" ON "HistoricalMarAttestation"("organizationId", "employeeId", "signedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricalMarAttestation_organizationId_snapshotHash_key" ON "HistoricalMarAttestation"("organizationId", "snapshotHash");

-- AddForeignKey
ALTER TABLE "HistoricalMarImportBatch" ADD CONSTRAINT "HistoricalMarImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarImportBatch" ADD CONSTRAINT "HistoricalMarImportBatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarImportBatch" ADD CONSTRAINT "HistoricalMarImportBatch_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "HistoricalMarImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "ClientMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_axisCareVisitId_fkey" FOREIGN KEY ("axisCareVisitId") REFERENCES "AxisCareVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "HistoricalMarAttestation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarEntry" ADD CONSTRAINT "HistoricalMarEntry_finalizedDoseId_fkey" FOREIGN KEY ("finalizedDoseId") REFERENCES "ClientMedicationDose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarAttestation" ADD CONSTRAINT "HistoricalMarAttestation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarAttestation" ADD CONSTRAINT "HistoricalMarAttestation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "HistoricalMarImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarAttestation" ADD CONSTRAINT "HistoricalMarAttestation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarAttestation" ADD CONSTRAINT "HistoricalMarAttestation_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalMarAttestation" ADD CONSTRAINT "HistoricalMarAttestation_medicationSignatureId_fkey" FOREIGN KEY ("medicationSignatureId") REFERENCES "MedicationStaffSignature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
