-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'READY', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "OnboardingTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OnboardingTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "OnboardingStepType" AS ENUM ('EMPLOYEE_INFORMATION', 'EMPLOYMENT_EVENT', 'COMPLIANCE_REQUIREMENT', 'TRAINING', 'COMPETENCY', 'POLICY_ACKNOWLEDGMENT', 'CREDENTIAL', 'MANUAL_ADMIN_CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "OnboardingStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PolicyVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PolicyAssignmentSource" AS ENUM ('ONBOARDING', 'COMPLIANCE', 'MANUAL', 'ORGANIZATION_POLICY');

-- CreateEnum
CREATE TYPE "PolicyAssignmentStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'OVERDUE', 'SUPERSEDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkReadinessTrigger" AS ENUM ('ONBOARDING_UPDATED', 'COMPLIANCE_CHANGED', 'TRAINING_COMPLETED', 'COMPETENCY_FINALIZED', 'POLICY_ACKNOWLEDGED', 'CREDENTIAL_CHANGED', 'MANUAL_REEVALUATION');

-- CreateTable
CREATE TABLE "OnboardingTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerType" "EvidenceOwnerType" NOT NULL,
    "licenseType" "LicenseType",
    "status" "OnboardingTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTemplateVersion" (
    "id" TEXT NOT NULL,
    "onboardingTemplateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "OnboardingTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE,
    "effectiveUntil" DATE,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingStepDefinition" (
    "id" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stepType" "OnboardingStepType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "blockingScope" "BlockingScope",
    "configurationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingStepDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeOnboarding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeOnboardingStep" (
    "id" TEXT NOT NULL,
    "employeeOnboardingId" TEXT NOT NULL,
    "stepDefinitionId" TEXT NOT NULL,
    "status" "OnboardingStepStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "sourceResourceType" TEXT,
    "sourceResourceId" TEXT,
    "explanationJson" JSONB,
    "administrativeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeOnboardingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "requiresAcknowledgment" BOOLEAN NOT NULL DEFAULT false,
    "reacknowledgeOnNewVersion" BOOLEAN NOT NULL DEFAULT false,
    "blockingScope" "BlockingScope",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "PolicyVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "publishedAt" TIMESTAMP(3),
    "body" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAssignment" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "policyVersionId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "assignedByUserId" TEXT,
    "sourceType" "PolicyAssignmentSource" NOT NULL,
    "sourceReferenceId" TEXT,
    "status" "PolicyAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "acknowledgedAt" TIMESTAMP(3),
    "attestationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkReadinessEvaluation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "evaluationTrigger" "WorkReadinessTrigger" NOT NULL,
    "resultJson" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkReadinessEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingTemplate_ownerType_licenseType_status_idx" ON "OnboardingTemplate"("ownerType", "licenseType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplate_organizationId_code_key" ON "OnboardingTemplate"("organizationId", "code");

-- CreateIndex
CREATE INDEX "OnboardingTemplateVersion_status_effectiveFrom_effectiveUnt_idx" ON "OnboardingTemplateVersion"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplateVersion_onboardingTemplateId_versionNumbe_key" ON "OnboardingTemplateVersion"("onboardingTemplateId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingStepDefinition_templateVersionId_sequence_key" ON "OnboardingStepDefinition"("templateVersionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingStepDefinition_templateVersionId_code_key" ON "OnboardingStepDefinition"("templateVersionId", "code");

-- CreateIndex
CREATE INDEX "EmployeeOnboarding_organizationId_status_idx" ON "EmployeeOnboarding"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeOnboarding_employeeId_templateVersionId_key" ON "EmployeeOnboarding"("employeeId", "templateVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeOnboardingStep_employeeOnboardingId_stepDefinitionI_key" ON "EmployeeOnboardingStep"("employeeOnboardingId", "stepDefinitionId");

-- CreateIndex
CREATE INDEX "Policy_organizationId_status_idx" ON "Policy"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_organizationId_code_key" ON "Policy"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PolicyVersion_status_effectiveFrom_effectiveUntil_idx" ON "PolicyVersion"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_policyId_versionNumber_key" ON "PolicyVersion"("policyId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAssignment_fingerprint_key" ON "PolicyAssignment"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAssignment_attestationId_key" ON "PolicyAssignment"("attestationId");

-- CreateIndex
CREATE INDEX "PolicyAssignment_organizationId_employeeId_status_idx" ON "PolicyAssignment"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "WorkReadinessEvaluation_organizationId_employeeId_evaluated_idx" ON "WorkReadinessEvaluation"("organizationId", "employeeId", "evaluatedAt");

-- AddForeignKey
ALTER TABLE "OnboardingTemplate" ADD CONSTRAINT "OnboardingTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTemplateVersion" ADD CONSTRAINT "OnboardingTemplateVersion_onboardingTemplateId_fkey" FOREIGN KEY ("onboardingTemplateId") REFERENCES "OnboardingTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingStepDefinition" ADD CONSTRAINT "OnboardingStepDefinition_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "OnboardingTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOnboarding" ADD CONSTRAINT "EmployeeOnboarding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOnboarding" ADD CONSTRAINT "EmployeeOnboarding_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOnboarding" ADD CONSTRAINT "EmployeeOnboarding_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "OnboardingTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOnboarding" ADD CONSTRAINT "EmployeeOnboarding_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOnboardingStep" ADD CONSTRAINT "EmployeeOnboardingStep_employeeOnboardingId_fkey" FOREIGN KEY ("employeeOnboardingId") REFERENCES "EmployeeOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOnboardingStep" ADD CONSTRAINT "EmployeeOnboardingStep_stepDefinitionId_fkey" FOREIGN KEY ("stepDefinitionId") REFERENCES "OnboardingStepDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeOnboardingStep" ADD CONSTRAINT "EmployeeOnboardingStep_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "Attestation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReadinessEvaluation" ADD CONSTRAINT "WorkReadinessEvaluation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkReadinessEvaluation" ADD CONSTRAINT "WorkReadinessEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
