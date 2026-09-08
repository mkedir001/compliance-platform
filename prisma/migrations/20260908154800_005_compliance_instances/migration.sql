-- CreateEnum
CREATE TYPE "EvaluationScopeType" AS ENUM ('EMPLOYEE', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "ComplianceEvaluationTrigger" AS ENUM ('EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED', 'ROLE_CHANGED', 'DUTY_CHANGED', 'SERVICE_EVENT_CREATED', 'RULESET_CHANGED', 'MANUAL', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ComplianceTriggerType" AS ENUM ('EMPLOYEE_HIRED', 'FIRST_DIRECT_CONTACT', 'FIRST_UNSUPERVISED_DIRECT_CONTACT', 'DUTY_ASSIGNED', 'ROLE_ASSIGNED', 'FIXED_REQUIREMENT');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('REQUIRED', 'ASSIGNED', 'IN_PROGRESS', 'SATISFIED', 'WITHIN_LEGAL_DELAY', 'PAST_DUE', 'EXPIRED', 'BLOCKED', 'SUPERSEDED', 'WAIVED_BY_EQUIVALENCY');
-- CreateTable
CREATE TABLE "ComplianceEvaluationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" "EvaluationScopeType" NOT NULL,
    "scopeReference" TEXT,
    "rulesetId" TEXT NOT NULL,
    "rulesetVersionSnapshot" INTEGER NOT NULL,
    "trigger" "ComplianceEvaluationTrigger" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceEvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceInstance" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "triggerType" "ComplianceTriggerType" NOT NULL,
    "triggerReference" TEXT,
    "requiredAt" TIMESTAMP(3) NOT NULL,
    "nominalDueAt" TIMESTAMP(3),
    "statutoryDelayUntil" TIMESTAMP(3),
    "hardBlockAt" TIMESTAMP(3),
    "status" "ComplianceStatus" NOT NULL,
    "satisfiedAt" TIMESTAMP(3),
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL,
    "rulesetId" TEXT NOT NULL,
    "evaluationRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceInstanceEvidence" (
    "id" TEXT NOT NULL,
    "complianceInstanceId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceReferenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceInstanceEvidence_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ComplianceEvaluationRun_organizationId_startedAt_idx" ON "ComplianceEvaluationRun"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceInstance_fingerprint_key" ON "ComplianceInstance"("fingerprint");

-- CreateIndex
CREATE INDEX "ComplianceInstance_organizationId_employeeId_status_idx" ON "ComplianceInstance"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "ComplianceInstance_requirementVersionId_idx" ON "ComplianceInstance"("requirementVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceInstanceEvidence_complianceInstanceId_evidenceTyp_key" ON "ComplianceInstanceEvidence"("complianceInstanceId", "evidenceType", "evidenceReferenceId");
-- AddForeignKey
ALTER TABLE "ComplianceEvaluationRun" ADD CONSTRAINT "ComplianceEvaluationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationRun" ADD CONSTRAINT "ComplianceEvaluationRun_rulesetId_fkey" FOREIGN KEY ("rulesetId") REFERENCES "ComplianceRuleset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_rulesetId_fkey" FOREIGN KEY ("rulesetId") REFERENCES "ComplianceRuleset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstance" ADD CONSTRAINT "ComplianceInstance_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "ComplianceEvaluationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceInstanceEvidence" ADD CONSTRAINT "ComplianceInstanceEvidence_complianceInstanceId_fkey" FOREIGN KEY ("complianceInstanceId") REFERENCES "ComplianceInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
