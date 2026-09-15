-- CreateEnum
CREATE TYPE "ComplianceIssueType" AS ENUM ('TRAINING_REQUIRED', 'TRAINING_OVERDUE', 'COMPETENCY_REQUIRED', 'CREDENTIAL_INVALID', 'CREDENTIAL_EXPIRING', 'POLICY_ACKNOWLEDGMENT_REQUIRED', 'ONBOARDING_INCOMPLETE', 'PERSON_SPECIFIC_INSTRUCTION_REQUIRED', 'MEDICATION_QUALIFICATION_INCOMPLETE', 'MEDICATION_AUTHORIZATION_MISSING', 'CLINICAL_SIGNOFF_REQUIRED', 'ASSIGNMENT_BLOCKED', 'ACTIVE_ASSIGNMENT_BECAME_BLOCKED');

-- CreateEnum
CREATE TYPE "ComplianceIssuePriority" AS ENUM ('LOW', 'NORMAL', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ComplianceIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "ComplianceIssue" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "activeKey" TEXT,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "issueType" "ComplianceIssueType" NOT NULL,
    "priority" "ComplianceIssuePriority" NOT NULL,
    "status" "ComplianceIssueStatus" NOT NULL DEFAULT 'OPEN',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "serviceAssignmentId" TEXT,
    "contextJson" JSONB NOT NULL,
    "reasonCodesJson" JSONB NOT NULL,
    "remediationActionsJson" JSONB NOT NULL,
    "evidenceReferencesJson" JSONB NOT NULL,
    "dueAt" TIMESTAMP(3),
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "latestDetectedAt" TIMESTAMP(3) NOT NULL,
    "workflowStartedAt" TIMESTAMP(3),
    "workflowStartedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceIssueEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "complianceIssueId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceIssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceIssue_fingerprint_key" ON "ComplianceIssue"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceIssue_activeKey_key" ON "ComplianceIssue"("activeKey");

-- CreateIndex
CREATE INDEX "ComplianceIssue_organizationId_status_priority_idx" ON "ComplianceIssue"("organizationId", "status", "priority");

-- CreateIndex
CREATE INDEX "ComplianceIssue_organizationId_employeeId_status_idx" ON "ComplianceIssue"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "ComplianceIssue_organizationId_issueType_status_idx" ON "ComplianceIssue"("organizationId", "issueType", "status");

-- CreateIndex
CREATE INDEX "ComplianceIssue_organizationId_dueAt_idx" ON "ComplianceIssue"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "ComplianceIssue_serviceAssignmentId_status_idx" ON "ComplianceIssue"("serviceAssignmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceIssueEvent_dedupeKey_key" ON "ComplianceIssueEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "ComplianceIssueEvent_organizationId_action_createdAt_idx" ON "ComplianceIssueEvent"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceIssueEvent_complianceIssueId_createdAt_idx" ON "ComplianceIssueEvent"("complianceIssueId", "createdAt");

-- AddForeignKey
ALTER TABLE "ComplianceIssue" ADD CONSTRAINT "ComplianceIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceIssue" ADD CONSTRAINT "ComplianceIssue_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceIssue" ADD CONSTRAINT "ComplianceIssue_serviceAssignmentId_fkey" FOREIGN KEY ("serviceAssignmentId") REFERENCES "ServiceAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceIssue" ADD CONSTRAINT "ComplianceIssue_workflowStartedByUserId_fkey" FOREIGN KEY ("workflowStartedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceIssueEvent" ADD CONSTRAINT "ComplianceIssueEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceIssueEvent" ADD CONSTRAINT "ComplianceIssueEvent_complianceIssueId_fkey" FOREIGN KEY ("complianceIssueId") REFERENCES "ComplianceIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceIssueEvent" ADD CONSTRAINT "ComplianceIssueEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
