-- CreateEnum
CREATE TYPE "CompetencyMethod" AS ENUM ('KNOWLEDGE_TEST', 'OBSERVED_SKILL', 'SUPERVISOR_ATTESTATION', 'TRAINER_ATTESTATION', 'ORAL_COMPETENCY', 'EXTERNAL_CREDENTIAL', 'PRACTICAL_CHECKLIST');

-- CreateEnum
CREATE TYPE "EvidenceOwnerType" AS ENUM ('PLATFORM', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "CompetencyDefinitionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SkillChecklistVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CompetencyAssessmentStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'FINALIZED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CompetencyAssessmentResult" AS ENUM ('PASS', 'FAIL', 'REMEDIATION_REQUIRED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "CompetencyAssessmentItemResult" AS ENUM ('PASS', 'FAIL', 'NOT_OBSERVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ProfessionalCredentialType" AS ENUM ('RN', 'CNS', 'CNP', 'PA', 'PHYSICIAN', 'CPR_INSTRUCTOR', 'FIRST_AID_INSTRUCTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "CredentialVerificationStatus" AS ENUM ('UNVERIFIED', 'SELF_REPORTED', 'DOCUMENT_REVIEWED', 'VERIFIED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ProfessionalCredentialStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExternalTrainingReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'NEEDS_MORE_INFORMATION');

-- CreateEnum
CREATE TYPE "EquivalencyDecision" AS ENUM ('APPROVED', 'DENIED', 'NEEDS_MORE_INFORMATION');

-- CreateEnum
CREATE TYPE "AttestationType" AS ENUM ('POLICY_ACKNOWLEDGMENT', 'TRAINER_ATTESTATION', 'SUPERVISOR_COMPETENCY', 'EMPLOYEE_COMPLETION', 'DOCUMENT_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplianceEvidenceType" AS ENUM ('TRAINING_COMPLETION', 'ASSESSMENT', 'COMPETENCY_ASSESSMENT', 'ATTESTATION', 'EXTERNAL_TRAINING', 'EXTERNAL_CREDENTIAL', 'EQUIVALENCY_DECISION');

-- CreateEnum
CREATE TYPE "EvidenceCorrectionType" AS ENUM ('SUPERSEDED', 'VOIDED', 'CORRECTED_BY_REPLACEMENT', 'ADMINISTRATIVE_NOTE');

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('TRAINING', 'COMPETENCY', 'COMPLIANCE');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ACTIVE', 'REVOKED', 'SUPERSEDED', 'EXPIRED');

-- Preserve existing Phase 2/3 evidence while tightening the column to a typed enum.
ALTER TABLE "ComplianceInstanceEvidence"
ALTER COLUMN "evidenceType" TYPE "ComplianceEvidenceType"
USING "evidenceType"::"ComplianceEvidenceType";

-- CreateTable
CREATE TABLE "CompetencyDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "method" "CompetencyMethod" NOT NULL,
    "ownerType" "EvidenceOwnerType" NOT NULL,
    "organizationId" TEXT,
    "status" "CompetencyDefinitionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetencyDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyRequirement" (
    "id" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "competencyDefinitionId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetencyRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillChecklist" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerType" "EvidenceOwnerType" NOT NULL,
    "organizationId" TEXT,
    "status" "CompetencyDefinitionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillChecklistVersion" (
    "id" TEXT NOT NULL,
    "skillChecklistId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "SkillChecklistVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE,
    "effectiveUntil" DATE,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillChecklistVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillChecklistItem" (
    "id" TEXT NOT NULL,
    "skillChecklistVersionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "criticalFailure" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "competencyDefinitionId" TEXT NOT NULL,
    "skillChecklistVersionId" TEXT,
    "trainingAssignmentId" TEXT,
    "complianceInstanceId" TEXT,
    "assessorUserId" TEXT NOT NULL,
    "assessorEmployeeId" TEXT,
    "assessorNameSnapshot" TEXT NOT NULL,
    "assessorQualificationSnapshot" JSONB,
    "status" "CompetencyAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "result" "CompetencyAssessmentResult",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetencyAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyAssessmentItem" (
    "id" TEXT NOT NULL,
    "competencyAssessmentId" TEXT NOT NULL,
    "skillChecklistItemId" TEXT NOT NULL,
    "result" "CompetencyAssessmentItemResult" NOT NULL,
    "notes" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetencyAssessmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "userId" TEXT,
    "credentialType" "ProfessionalCredentialType" NOT NULL,
    "credentialName" TEXT,
    "licenseNumber" TEXT,
    "jurisdiction" TEXT,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "verificationStatus" "CredentialVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "evidenceReference" TEXT,
    "status" "ProfessionalCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalTrainingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "trainingName" TEXT NOT NULL,
    "trainingDate" DATE NOT NULL,
    "trainingMinutes" INTEGER,
    "credentialNumber" TEXT,
    "expiresAt" DATE,
    "evidenceReference" TEXT,
    "reviewStatus" "ExternalTrainingReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalTrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementEquivalencyDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalTrainingRecordId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "decision" "EquivalencyDecision" NOT NULL,
    "competencyVerified" BOOLEAN NOT NULL DEFAULT false,
    "reviewerUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementEquivalencyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attestation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "attestationType" "AttestationType" NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "signerEmployeeId" TEXT,
    "typedName" TEXT NOT NULL,
    "statementVersion" TEXT NOT NULL,
    "statementSnapshot" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceVersionId" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sessionReference" TEXT,
    "signatureHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSubjectEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trainingCompletionId" TEXT NOT NULL,
    "subjectAreaCode" TEXT NOT NULL,
    "subjectAreaName" TEXT,
    "minutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingSubjectEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceCorrection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "correctionType" "EvidenceCorrectionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedByUserId" TEXT NOT NULL,
    "replacementResourceType" TEXT,
    "replacementResourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "certificateType" "CertificateType" NOT NULL,
    "certificateNumber" TEXT NOT NULL,
    "courseVersionId" TEXT,
    "trainingCompletionId" TEXT,
    "competencyAssessmentId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "verificationToken" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "certificateSnapshotJson" JSONB NOT NULL,
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetencyDefinition_code_ownerType_idx" ON "CompetencyDefinition"("code", "ownerType");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyDefinition_organizationId_code_key" ON "CompetencyDefinition"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyRequirement_requirementVersionId_competencyDefini_key" ON "CompetencyRequirement"("requirementVersionId", "competencyDefinitionId");

-- CreateIndex
CREATE INDEX "SkillChecklist_code_ownerType_idx" ON "SkillChecklist"("code", "ownerType");

-- CreateIndex
CREATE UNIQUE INDEX "SkillChecklist_organizationId_code_key" ON "SkillChecklist"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SkillChecklistVersion_skillChecklistId_versionNumber_key" ON "SkillChecklistVersion"("skillChecklistId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SkillChecklistItem_skillChecklistVersionId_sequence_key" ON "SkillChecklistItem"("skillChecklistVersionId", "sequence");

-- CreateIndex
CREATE INDEX "CompetencyAssessment_organizationId_employeeId_status_idx" ON "CompetencyAssessment"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyAssessmentItem_competencyAssessmentId_skillCheckl_key" ON "CompetencyAssessmentItem"("competencyAssessmentId", "skillChecklistItemId");

-- CreateIndex
CREATE INDEX "ProfessionalCredential_organizationId_employeeId_idx" ON "ProfessionalCredential"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "ExternalTrainingRecord_organizationId_employeeId_idx" ON "ExternalTrainingRecord"("organizationId", "employeeId");

-- CreateIndex
CREATE INDEX "RequirementEquivalencyDecision_organizationId_requirementVe_idx" ON "RequirementEquivalencyDecision"("organizationId", "requirementVersionId");

-- CreateIndex
CREATE INDEX "Attestation_organizationId_resourceType_resourceId_idx" ON "Attestation"("organizationId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "TrainingSubjectEvidence_organizationId_idx" ON "TrainingSubjectEvidence"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSubjectEvidence_trainingCompletionId_subjectAreaCod_key" ON "TrainingSubjectEvidence"("trainingCompletionId", "subjectAreaCode");

-- CreateIndex
CREATE INDEX "EvidenceCorrection_organizationId_resourceType_resourceId_idx" ON "EvidenceCorrection"("organizationId", "resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_certificateNumber_key" ON "Certificate"("certificateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_verificationToken_key" ON "Certificate"("verificationToken");

-- CreateIndex
CREATE INDEX "Certificate_organizationId_employeeId_status_idx" ON "Certificate"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_trainingCompletionId_certificateType_key" ON "Certificate"("trainingCompletionId", "certificateType");

-- CreateIndex

-- AddForeignKey
ALTER TABLE "CompetencyDefinition" ADD CONSTRAINT "CompetencyDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyRequirement" ADD CONSTRAINT "CompetencyRequirement_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyRequirement" ADD CONSTRAINT "CompetencyRequirement_competencyDefinitionId_fkey" FOREIGN KEY ("competencyDefinitionId") REFERENCES "CompetencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillChecklist" ADD CONSTRAINT "SkillChecklist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillChecklistVersion" ADD CONSTRAINT "SkillChecklistVersion_skillChecklistId_fkey" FOREIGN KEY ("skillChecklistId") REFERENCES "SkillChecklist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillChecklistItem" ADD CONSTRAINT "SkillChecklistItem_skillChecklistVersionId_fkey" FOREIGN KEY ("skillChecklistVersionId") REFERENCES "SkillChecklistVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_competencyDefinitionId_fkey" FOREIGN KEY ("competencyDefinitionId") REFERENCES "CompetencyDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_skillChecklistVersionId_fkey" FOREIGN KEY ("skillChecklistVersionId") REFERENCES "SkillChecklistVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_complianceInstanceId_fkey" FOREIGN KEY ("complianceInstanceId") REFERENCES "ComplianceInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_assessorUserId_fkey" FOREIGN KEY ("assessorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessment" ADD CONSTRAINT "CompetencyAssessment_assessorEmployeeId_fkey" FOREIGN KEY ("assessorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessmentItem" ADD CONSTRAINT "CompetencyAssessmentItem_competencyAssessmentId_fkey" FOREIGN KEY ("competencyAssessmentId") REFERENCES "CompetencyAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyAssessmentItem" ADD CONSTRAINT "CompetencyAssessmentItem_skillChecklistItemId_fkey" FOREIGN KEY ("skillChecklistItemId") REFERENCES "SkillChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalCredential" ADD CONSTRAINT "ProfessionalCredential_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalTrainingRecord" ADD CONSTRAINT "ExternalTrainingRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalTrainingRecord" ADD CONSTRAINT "ExternalTrainingRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalTrainingRecord" ADD CONSTRAINT "ExternalTrainingRecord_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementEquivalencyDecision" ADD CONSTRAINT "RequirementEquivalencyDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementEquivalencyDecision" ADD CONSTRAINT "RequirementEquivalencyDecision_externalTrainingRecordId_fkey" FOREIGN KEY ("externalTrainingRecordId") REFERENCES "ExternalTrainingRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementEquivalencyDecision" ADD CONSTRAINT "RequirementEquivalencyDecision_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementEquivalencyDecision" ADD CONSTRAINT "RequirementEquivalencyDecision_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attestation" ADD CONSTRAINT "Attestation_signerEmployeeId_fkey" FOREIGN KEY ("signerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSubjectEvidence" ADD CONSTRAINT "TrainingSubjectEvidence_trainingCompletionId_fkey" FOREIGN KEY ("trainingCompletionId") REFERENCES "TrainingCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceCorrection" ADD CONSTRAINT "EvidenceCorrection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceCorrection" ADD CONSTRAINT "EvidenceCorrection_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_trainingCompletionId_fkey" FOREIGN KEY ("trainingCompletionId") REFERENCES "TrainingCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_competencyAssessmentId_fkey" FOREIGN KEY ("competencyAssessmentId") REFERENCES "CompetencyAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
