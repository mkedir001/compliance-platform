CREATE TYPE "WorkforceEvidenceReadinessStatus" AS ENUM ('NOT_RECORDED', 'EVIDENCE_SUBMITTED', 'NEEDS_TRAINING');

CREATE TYPE "WorkforceMedicationReadinessStatus" AS ENUM ('NOT_RECORDED', 'EVIDENCE_SUBMITTED', 'NEEDS_TRAINING', 'NOT_CURRENTLY_APPLICABLE');

CREATE TABLE "EmployeeWorkforceReadiness" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "firstAidStatus" "WorkforceEvidenceReadinessStatus" NOT NULL DEFAULT 'NOT_RECORDED',
    "firstAidEvidenceRecordId" TEXT,
    "medicationStatus" "WorkforceMedicationReadinessStatus" NOT NULL DEFAULT 'NOT_RECORDED',
    "medicationEvidenceRecordId" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeWorkforceReadiness_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SignatureSigner" ADD COLUMN "identityPending" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "EmployeeWorkforceReadiness_employeeId_key" ON "EmployeeWorkforceReadiness"("employeeId");
CREATE UNIQUE INDEX "EmployeeWorkforceReadiness_firstAidEvidenceRecordId_key" ON "EmployeeWorkforceReadiness"("firstAidEvidenceRecordId");
CREATE UNIQUE INDEX "EmployeeWorkforceReadiness_medicationEvidenceRecordId_key" ON "EmployeeWorkforceReadiness"("medicationEvidenceRecordId");
CREATE INDEX "EmployeeWorkforceReadiness_organizationId_firstAidStatus_idx" ON "EmployeeWorkforceReadiness"("organizationId", "firstAidStatus");
CREATE INDEX "EmployeeWorkforceReadiness_organizationId_medicationStatus_idx" ON "EmployeeWorkforceReadiness"("organizationId", "medicationStatus");

ALTER TABLE "EmployeeWorkforceReadiness" ADD CONSTRAINT "EmployeeWorkforceReadiness_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeWorkforceReadiness" ADD CONSTRAINT "EmployeeWorkforceReadiness_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeWorkforceReadiness" ADD CONSTRAINT "EmployeeWorkforceReadiness_firstAidEvidenceRecordId_fkey" FOREIGN KEY ("firstAidEvidenceRecordId") REFERENCES "ExternalTrainingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeWorkforceReadiness" ADD CONSTRAINT "EmployeeWorkforceReadiness_medicationEvidenceRecordId_fkey" FOREIGN KEY ("medicationEvidenceRecordId") REFERENCES "ExternalTrainingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
