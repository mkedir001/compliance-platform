-- CreateEnum
CREATE TYPE "ClinicalApprovalStatus" AS ENUM ('APPROVED', 'REVOKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MedicationQualificationDecision" AS ENUM ('APPROVED', 'DENIED');

-- CreateEnum
CREATE TYPE "MedicationQualificationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MedicationInstructionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MedicationAuthorizationType" AS ENUM ('AUTHORIZATION', 'DELEGATION', 'ORGANIZATION_ASSIGNMENT', 'CLINICAL_DIRECTION');

-- CreateEnum
CREATE TYPE "MedicationAuthorizationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "TrainingCourseVersion" ADD COLUMN     "clinicalGovernanceRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MedicationQualificationPathway" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "competencyDefinitionId" TEXT NOT NULL,
    "skillChecklistVersionId" TEXT NOT NULL,
    "requiresKnowledgeAssessment" BOOLEAN NOT NULL DEFAULT true,
    "requiresObservedSkill" BOOLEAN NOT NULL DEFAULT true,
    "requiresClinicalSignoff" BOOLEAN NOT NULL DEFAULT true,
    "requiresPersonInstruction" BOOLEAN NOT NULL DEFAULT true,
    "requiresAuthorization" BOOLEAN NOT NULL DEFAULT true,
    "requiresDelegation" BOOLEAN NOT NULL DEFAULT false,
    "requiresMedicationDuty" BOOLEAN NOT NULL DEFAULT true,
    "validityDays" INTEGER,
    "allowedReviewerCredentialTypes" "ProfessionalCredentialType"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationQualificationPathway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalCurriculumApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "reviewerCredentialId" TEXT NOT NULL,
    "attestationId" TEXT NOT NULL,
    "status" "ClinicalApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "contentHashSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalCurriculumApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationQualification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "trainingCompletionId" TEXT NOT NULL,
    "competencyAssessmentId" TEXT NOT NULL,
    "skillChecklistVersionId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "reviewerCredentialId" TEXT NOT NULL,
    "attestationId" TEXT NOT NULL,
    "decision" "MedicationQualificationDecision" NOT NULL,
    "status" "MedicationQualificationStatus" NOT NULL DEFAULT 'ACTIVE',
    "qualifiedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "evidenceSnapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonSpecificMedicationInstruction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "serviceRecipientRef" TEXT NOT NULL,
    "procedureReference" TEXT NOT NULL,
    "procedureVersion" TEXT,
    "reviewerUserId" TEXT NOT NULL,
    "reviewerCredentialId" TEXT NOT NULL,
    "attestationId" TEXT NOT NULL,
    "instructedAt" TIMESTAMP(3) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "status" "MedicationInstructionStatus" NOT NULL DEFAULT 'ACTIVE',
    "evidenceBasis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonSpecificMedicationInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicationAuthorizationEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "serviceRecipientRef" TEXT,
    "authorizationType" "MedicationAuthorizationType" NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "reviewerCredentialId" TEXT,
    "attestationId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "status" "MedicationAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "evidenceBasis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicationAuthorizationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalGovernanceEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalGovernanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MedicationQualificationPathway_organizationId_courseVersion_idx" ON "MedicationQualificationPathway"("organizationId", "courseVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationQualificationPathway_organizationId_requirementVe_key" ON "MedicationQualificationPathway"("organizationId", "requirementVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalCurriculumApproval_attestationId_key" ON "ClinicalCurriculumApproval"("attestationId");

-- CreateIndex
CREATE INDEX "ClinicalCurriculumApproval_organizationId_courseVersionId_s_idx" ON "ClinicalCurriculumApproval"("organizationId", "courseVersionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationQualification_attestationId_key" ON "MedicationQualification"("attestationId");

-- CreateIndex
CREATE INDEX "MedicationQualification_organizationId_employeeId_status_idx" ON "MedicationQualification"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationQualification_trainingCompletionId_competencyAsse_key" ON "MedicationQualification"("trainingCompletionId", "competencyAssessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonSpecificMedicationInstruction_attestationId_key" ON "PersonSpecificMedicationInstruction"("attestationId");

-- CreateIndex
CREATE INDEX "PersonSpecificMedicationInstruction_organizationId_employee_idx" ON "PersonSpecificMedicationInstruction"("organizationId", "employeeId", "serviceRecipientRef", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MedicationAuthorizationEvidence_attestationId_key" ON "MedicationAuthorizationEvidence"("attestationId");

-- CreateIndex
CREATE INDEX "MedicationAuthorizationEvidence_organizationId_employeeId_s_idx" ON "MedicationAuthorizationEvidence"("organizationId", "employeeId", "serviceRecipientRef", "status");

-- CreateIndex
CREATE INDEX "ClinicalGovernanceEvent_organizationId_entityType_entityId__idx" ON "ClinicalGovernanceEvent"("organizationId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalGovernanceEvent_action_createdAt_idx" ON "ClinicalGovernanceEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "MedicationQualificationPathway" ADD CONSTRAINT "MedicationQualificationPathway_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualificationPathway" ADD CONSTRAINT "MedicationQualificationPathway_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualificationPathway" ADD CONSTRAINT "MedicationQualificationPathway_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualificationPathway" ADD CONSTRAINT "MedicationQualificationPathway_competencyDefinitionId_fkey" FOREIGN KEY ("competencyDefinitionId") REFERENCES "CompetencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualificationPathway" ADD CONSTRAINT "MedicationQualificationPathway_skillChecklistVersionId_fkey" FOREIGN KEY ("skillChecklistVersionId") REFERENCES "SkillChecklistVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalCurriculumApproval" ADD CONSTRAINT "ClinicalCurriculumApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalCurriculumApproval" ADD CONSTRAINT "ClinicalCurriculumApproval_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalCurriculumApproval" ADD CONSTRAINT "ClinicalCurriculumApproval_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalCurriculumApproval" ADD CONSTRAINT "ClinicalCurriculumApproval_reviewerCredentialId_fkey" FOREIGN KEY ("reviewerCredentialId") REFERENCES "ProfessionalCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalCurriculumApproval" ADD CONSTRAINT "ClinicalCurriculumApproval_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "Attestation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_trainingCompletionId_fkey" FOREIGN KEY ("trainingCompletionId") REFERENCES "TrainingCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_competencyAssessmentId_fkey" FOREIGN KEY ("competencyAssessmentId") REFERENCES "CompetencyAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_skillChecklistVersionId_fkey" FOREIGN KEY ("skillChecklistVersionId") REFERENCES "SkillChecklistVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_reviewerCredentialId_fkey" FOREIGN KEY ("reviewerCredentialId") REFERENCES "ProfessionalCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationQualification" ADD CONSTRAINT "MedicationQualification_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "Attestation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSpecificMedicationInstruction" ADD CONSTRAINT "PersonSpecificMedicationInstruction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSpecificMedicationInstruction" ADD CONSTRAINT "PersonSpecificMedicationInstruction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSpecificMedicationInstruction" ADD CONSTRAINT "PersonSpecificMedicationInstruction_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSpecificMedicationInstruction" ADD CONSTRAINT "PersonSpecificMedicationInstruction_reviewerCredentialId_fkey" FOREIGN KEY ("reviewerCredentialId") REFERENCES "ProfessionalCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSpecificMedicationInstruction" ADD CONSTRAINT "PersonSpecificMedicationInstruction_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "Attestation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAuthorizationEvidence" ADD CONSTRAINT "MedicationAuthorizationEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAuthorizationEvidence" ADD CONSTRAINT "MedicationAuthorizationEvidence_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAuthorizationEvidence" ADD CONSTRAINT "MedicationAuthorizationEvidence_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAuthorizationEvidence" ADD CONSTRAINT "MedicationAuthorizationEvidence_reviewerCredentialId_fkey" FOREIGN KEY ("reviewerCredentialId") REFERENCES "ProfessionalCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicationAuthorizationEvidence" ADD CONSTRAINT "MedicationAuthorizationEvidence_attestationId_fkey" FOREIGN KEY ("attestationId") REFERENCES "Attestation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalGovernanceEvent" ADD CONSTRAINT "ClinicalGovernanceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalGovernanceEvent" ADD CONSTRAINT "ClinicalGovernanceEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
