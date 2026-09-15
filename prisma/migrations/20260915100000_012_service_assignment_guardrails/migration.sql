-- CreateEnum
CREATE TYPE "ServiceAssignmentStatus" AS ENUM ('PROPOSED', 'BLOCKED', 'ACTIVE', 'INACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentEligibilityDecision" AS ENUM ('ELIGIBLE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AssignmentEligibilityTrigger" AS ENUM ('PROPOSAL', 'CREATION', 'ACTIVATION', 'REEVALUATION', 'OVERRIDE_ATTEMPT');

-- CreateTable
CREATE TABLE "ServiceAssignmentRequirementRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "programId" TEXT,
    "locationId" TEXT,
    "serviceRecipientRef" TEXT,
    "dutyDefinitionId" TEXT,
    "requirementVersionId" TEXT,
    "medicationPathwayId" TEXT,
    "blockingScope" "BlockingScope" NOT NULL DEFAULT 'GENERAL_WORK',
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAssignmentRequirementRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "programId" TEXT,
    "locationId" TEXT,
    "serviceRecipientRef" TEXT,
    "blockingScope" "BlockingScope" NOT NULL DEFAULT 'GENERAL_WORK',
    "medicationPathwayId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "ServiceAssignmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdByUserId" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAssignmentDuty" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "dutyDefinitionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAssignmentDuty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAssignmentRequirement" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "ruleIdSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAssignmentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAssignmentEligibilityEvaluation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "trigger" "AssignmentEligibilityTrigger" NOT NULL,
    "decision" "AssignmentEligibilityDecision" NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "previousEvaluationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAssignmentEligibilityEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAssignmentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceAssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceAssignmentRequirementRule_organizationId_status_idx" ON "ServiceAssignmentRequirementRule"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ServiceAssignmentRequirementRule_organizationId_programId_l_idx" ON "ServiceAssignmentRequirementRule"("organizationId", "programId", "locationId");

-- CreateIndex
CREATE INDEX "ServiceAssignmentRequirementRule_organizationId_serviceReci_idx" ON "ServiceAssignmentRequirementRule"("organizationId", "serviceRecipientRef");

-- CreateIndex
CREATE INDEX "ServiceAssignment_organizationId_status_startsAt_idx" ON "ServiceAssignment"("organizationId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "ServiceAssignment_organizationId_employeeId_status_idx" ON "ServiceAssignment"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "ServiceAssignment_organizationId_serviceRecipientRef_status_idx" ON "ServiceAssignment"("organizationId", "serviceRecipientRef", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAssignmentDuty_assignmentId_dutyDefinitionId_key" ON "ServiceAssignmentDuty"("assignmentId", "dutyDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAssignmentRequirement_assignmentId_requirementVersio_key" ON "ServiceAssignmentRequirement"("assignmentId", "requirementVersionId");

-- CreateIndex
CREATE INDEX "ServiceAssignmentEligibilityEvaluation_organizationId_emplo_idx" ON "ServiceAssignmentEligibilityEvaluation"("organizationId", "employeeId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "ServiceAssignmentEligibilityEvaluation_assignmentId_evaluat_idx" ON "ServiceAssignmentEligibilityEvaluation"("assignmentId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "ServiceAssignmentEvent_organizationId_action_createdAt_idx" ON "ServiceAssignmentEvent"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceAssignmentEvent_assignmentId_createdAt_idx" ON "ServiceAssignmentEvent"("assignmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ServiceAssignmentRequirementRule" ADD CONSTRAINT "ServiceAssignmentRequirementRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentRequirementRule" ADD CONSTRAINT "ServiceAssignmentRequirementRule_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentRequirementRule" ADD CONSTRAINT "ServiceAssignmentRequirementRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentRequirementRule" ADD CONSTRAINT "ServiceAssignmentRequirementRule_dutyDefinitionId_fkey" FOREIGN KEY ("dutyDefinitionId") REFERENCES "DutyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentRequirementRule" ADD CONSTRAINT "ServiceAssignmentRequirementRule_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentRequirementRule" ADD CONSTRAINT "ServiceAssignmentRequirementRule_medicationPathwayId_fkey" FOREIGN KEY ("medicationPathwayId") REFERENCES "MedicationQualificationPathway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_medicationPathwayId_fkey" FOREIGN KEY ("medicationPathwayId") REFERENCES "MedicationQualificationPathway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignment" ADD CONSTRAINT "ServiceAssignment_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentDuty" ADD CONSTRAINT "ServiceAssignmentDuty_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ServiceAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentDuty" ADD CONSTRAINT "ServiceAssignmentDuty_dutyDefinitionId_fkey" FOREIGN KEY ("dutyDefinitionId") REFERENCES "DutyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentRequirement" ADD CONSTRAINT "ServiceAssignmentRequirement_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ServiceAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentRequirement" ADD CONSTRAINT "ServiceAssignmentRequirement_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentEligibilityEvaluation" ADD CONSTRAINT "ServiceAssignmentEligibilityEvaluation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentEligibilityEvaluation" ADD CONSTRAINT "ServiceAssignmentEligibilityEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentEligibilityEvaluation" ADD CONSTRAINT "ServiceAssignmentEligibilityEvaluation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ServiceAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentEligibilityEvaluation" ADD CONSTRAINT "ServiceAssignmentEligibilityEvaluation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentEvent" ADD CONSTRAINT "ServiceAssignmentEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentEvent" ADD CONSTRAINT "ServiceAssignmentEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ServiceAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAssignmentEvent" ADD CONSTRAINT "ServiceAssignmentEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
