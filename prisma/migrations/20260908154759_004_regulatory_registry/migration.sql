-- CreateEnum
CREATE TYPE "RegulationVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PRIMARY_SOURCE_VERIFIED', 'PRIMARY_SOURCE_CLINICAL_GOVERNANCE', 'DHS_GUIDANCE_VERIFIED', 'ORGANIZATION_POLICY', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "RequirementCategory" AS ENUM ('WORKFORCE', 'PERSON_SPECIFIC', 'MEDICATION', 'CLINICAL', 'POSITIVE_SUPPORTS', 'PERSONNEL_RECORD', 'ORGANIZATION_POLICY', 'OTHER');

-- CreateEnum
CREATE TYPE "RequirementVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "BlockingScope" AS ENUM ('GENERAL_WORK', 'DIRECT_CONTACT', 'UNSUPERVISED_CONTACT', 'PERSON_SPECIFIC_TASK', 'MEDICATION_ADMINISTRATION');

-- CreateEnum
CREATE TYPE "RequirementAuthorityRelationship" AS ENUM ('PRIMARY', 'SUPPORTING', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "RulesetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED');
-- CreateTable
CREATE TABLE "RegulatoryAuthority" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Regulation" (
    "id" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "citation" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Regulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulationVersion" (
    "id" TEXT NOT NULL,
    "regulationId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "sourceUrl" TEXT NOT NULL,
    "sourceTextSnapshotObjectKey" TEXT,
    "contentHash" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "status" "RegulationVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRequirement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "licenseType" "LicenseType" NOT NULL,
    "requirementCategory" "RequirementCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRequirementVersion" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "verificationStatus" "VerificationStatus" NOT NULL,
    "status" "RequirementVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "applicabilityDefinition" JSONB NOT NULL,
    "triggerDefinition" JSONB NOT NULL,
    "deadlineDefinition" JSONB NOT NULL,
    "recurrenceDefinition" JSONB,
    "competencyDefinition" JSONB,
    "evidenceDefinition" JSONB,
    "legalGraceDefinition" JSONB,
    "blockingScope" "BlockingScope",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRequirementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementAuthorityMapping" (
    "id" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "regulationVersionId" TEXT NOT NULL,
    "relationshipType" "RequirementAuthorityRelationship" NOT NULL,
    "citationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementAuthorityMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRuleset" (
    "id" TEXT NOT NULL,
    "licenseType" "LicenseType" NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "status" "RulesetStatus" NOT NULL DEFAULT 'DRAFT',
    "contentHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRuleset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRulesetRequirement" (
    "id" TEXT NOT NULL,
    "rulesetId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceRulesetRequirement_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryAuthority_jurisdiction_agency_name_key" ON "RegulatoryAuthority"("jurisdiction", "agency", "name");

-- CreateIndex
CREATE INDEX "Regulation_citation_idx" ON "Regulation"("citation");

-- CreateIndex
CREATE UNIQUE INDEX "Regulation_authorityId_citation_key" ON "Regulation"("authorityId", "citation");

-- CreateIndex
CREATE INDEX "RegulationVersion_status_effectiveFrom_effectiveUntil_idx" ON "RegulationVersion"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE UNIQUE INDEX "RegulationVersion_regulationId_effectiveFrom_key" ON "RegulationVersion"("regulationId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRequirement_code_key" ON "ComplianceRequirement"("code");

-- CreateIndex
CREATE INDEX "ComplianceRequirementVersion_status_effectiveFrom_effective_idx" ON "ComplianceRequirementVersion"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRequirementVersion_requirementId_versionNumber_key" ON "ComplianceRequirementVersion"("requirementId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementAuthorityMapping_requirementVersionId_regulation_key" ON "RequirementAuthorityMapping"("requirementVersionId", "regulationVersionId", "relationshipType");

-- CreateIndex
CREATE INDEX "ComplianceRuleset_status_effectiveFrom_effectiveUntil_idx" ON "ComplianceRuleset"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRuleset_licenseType_version_key" ON "ComplianceRuleset"("licenseType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRulesetRequirement_rulesetId_requirementVersionId_key" ON "ComplianceRulesetRequirement"("rulesetId", "requirementVersionId");
-- AddForeignKey
ALTER TABLE "Regulation" ADD CONSTRAINT "Regulation_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "RegulatoryAuthority"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulationVersion" ADD CONSTRAINT "RegulationVersion_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "Regulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulationVersion" ADD CONSTRAINT "RegulationVersion_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRequirementVersion" ADD CONSTRAINT "ComplianceRequirementVersion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ComplianceRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAuthorityMapping" ADD CONSTRAINT "RequirementAuthorityMapping_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAuthorityMapping" ADD CONSTRAINT "RequirementAuthorityMapping_regulationVersionId_fkey" FOREIGN KEY ("regulationVersionId") REFERENCES "RegulationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRulesetRequirement" ADD CONSTRAINT "ComplianceRulesetRequirement_rulesetId_fkey" FOREIGN KEY ("rulesetId") REFERENCES "ComplianceRuleset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRulesetRequirement" ADD CONSTRAINT "ComplianceRulesetRequirement_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
