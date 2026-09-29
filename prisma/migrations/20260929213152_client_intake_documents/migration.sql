-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECTIVE', 'INTAKE_IN_PROGRESS', 'ACTIVE', 'DISCHARGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClientServiceStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClientIntakeStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ClientDocumentType" AS ENUM ('INTAKE_CHECKLIST', 'FACE_SHEET', 'RIGHTS_ACKNOWLEDGMENT', 'ROI');

-- CreateEnum
CREATE TYPE "ClientDocumentStatus" AS ENUM ('DRAFT', 'READY_FOR_SIGNATURE', 'PARTIALLY_SIGNED', 'COMPLETED', 'VOIDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SignatureEnvelopeStatus" AS ENUM ('DRAFT', 'READY', 'SENT', 'PARTIALLY_SIGNED', 'COMPLETED', 'VOIDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SignatureSignerStatus" AS ENUM ('PENDING', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SignatureMode" AS ENUM ('SIGN_NOW', 'SEND_FOR_SIGNATURE');

-- CreateEnum
CREATE TYPE "RoiDirection" AS ENUM ('RELEASE_TO', 'RECEIVE_FROM', 'BOTH');

-- CreateEnum
CREATE TYPE "RoiStatus" AS ENUM ('DRAFT', 'ACTIVE', 'REVOKED', 'EXPIRED', 'VOIDED');

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'PROSPECTIVE',
    "legalFirstName" TEXT NOT NULL,
    "legalLastName" TEXT NOT NULL,
    "preferredName" TEXT,
    "dateOfBirth" DATE NOT NULL,
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "maPmiNumber" TEXT,
    "waiverProgram" TEXT,
    "financialResponsibility" TEXT,
    "primaryLanguage" TEXT,
    "interpreterNeeded" BOOLEAN NOT NULL DEFAULT false,
    "preferredCommunication" TEXT,
    "livingSituation" TEXT,
    "strengthsInterests" TEXT,
    "culturalPractices" TEXT,
    "supportNeeds" TEXT,
    "dischargedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientService" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "startDate" DATE,
    "authorizedUnits" DECIMAL(12,2),
    "authorizedHours" DECIMAL(12,2),
    "authorizationStart" DATE,
    "authorizationEnd" DATE,
    "scheduleJson" JSONB,
    "status" "ClientServiceStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agency" TEXT,
    "contactType" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "supervisorName" TEXT,
    "supervisorPhone" TEXT,
    "addressJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProfessionalContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalContactId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientProfessionalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRepresentative" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "representativeType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressJson" JSONB,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRepresentative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientEmergencyContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "informationSharingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientEmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientHealthProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "primaryCareProvider" TEXT,
    "clinic" TEXT,
    "providerPhone" TEXT,
    "dentist" TEXT,
    "pharmacy" TEXT,
    "pharmacyPhone" TEXT,
    "healthInsurancePlan" TEXT,
    "memberId" TEXT,
    "diagnoses" TEXT,
    "allergiesReactions" TEXT,
    "specialDietTexture" TEXT,
    "chokingSwallowingRisk" TEXT,
    "seizureProtocol" TEXT,
    "mobilityEquipment" TEXT,
    "medicationResponsibility" TEXT,
    "otherHealthNeeds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientHealthProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMedication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "medication" TEXT NOT NULL,
    "dose" TEXT,
    "times" TEXT,
    "reason" TEXT,
    "prescriber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientMedication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientIntake" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "ClientIntakeStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStep" TEXT NOT NULL DEFAULT 'CLIENT',
    "progressJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSavedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientIntakeChecklistItem" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "ClientIntakeChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocumentTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" "ClientDocumentType" NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "contentJson" JSONB NOT NULL,
    "effectiveFrom" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "intakeId" TEXT,
    "templateId" TEXT NOT NULL,
    "documentType" "ClientDocumentType" NOT NULL,
    "status" "ClientDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "snapshotJson" JSONB NOT NULL,
    "renderedPdf" BYTEA,
    "finalPdf" BYTEA,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoiAuthorization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT,
    "direction" "RoiDirection" NOT NULL,
    "recipientName" TEXT NOT NULL,
    "relationshipRole" TEXT,
    "addressJson" JSONB,
    "phone" TEXT,
    "faxEmail" TEXT,
    "categories" JSONB NOT NULL,
    "limitations" TEXT,
    "purposes" JSONB NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "expirationDate" DATE NOT NULL,
    "expirationEvent" TEXT,
    "status" "RoiStatus" NOT NULL DEFAULT 'DRAFT',
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoiAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEnvelope" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "mode" "SignatureMode" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEnvelopeId" TEXT,
    "status" "SignatureEnvelopeStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureSigner" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "SignatureSignerStatus" NOT NULL DEFAULT 'PENDING',
    "providerSignerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "auditJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureSigner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_organizationId_status_legalLastName_legalFirstName_idx" ON "Client"("organizationId", "status", "legalLastName", "legalFirstName");

-- CreateIndex
CREATE INDEX "Client_organizationId_maPmiNumber_idx" ON "Client"("organizationId", "maPmiNumber");

-- CreateIndex
CREATE INDEX "ClientService_organizationId_clientId_status_idx" ON "ClientService"("organizationId", "clientId", "status");

-- CreateIndex
CREATE INDEX "ProfessionalContact_organizationId_name_idx" ON "ProfessionalContact"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ProfessionalContact_organizationId_agency_idx" ON "ProfessionalContact"("organizationId", "agency");

-- CreateIndex
CREATE INDEX "ClientProfessionalContact_organizationId_clientId_role_idx" ON "ClientProfessionalContact"("organizationId", "clientId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfessionalContact_clientId_professionalContactId_ro_key" ON "ClientProfessionalContact"("clientId", "professionalContactId", "role");

-- CreateIndex
CREATE INDEX "ClientRepresentative_organizationId_clientId_idx" ON "ClientRepresentative"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "ClientEmergencyContact_organizationId_clientId_idx" ON "ClientEmergencyContact"("organizationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientHealthProfile_clientId_key" ON "ClientHealthProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientHealthProfile_organizationId_clientId_idx" ON "ClientHealthProfile"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "ClientMedication_organizationId_clientId_idx" ON "ClientMedication"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "ClientIntake_organizationId_clientId_status_idx" ON "ClientIntake"("organizationId", "clientId", "status");

-- CreateIndex
CREATE INDEX "ClientIntakeChecklistItem_intakeId_sequence_idx" ON "ClientIntakeChecklistItem"("intakeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ClientIntakeChecklistItem_intakeId_code_key" ON "ClientIntakeChecklistItem"("intakeId", "code");

-- CreateIndex
CREATE INDEX "ClientDocumentTemplate_organizationId_documentType_status_idx" ON "ClientDocumentTemplate"("organizationId", "documentType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDocumentTemplate_organizationId_code_versionNumber_key" ON "ClientDocumentTemplate"("organizationId", "code", "versionNumber");

-- CreateIndex
CREATE INDEX "ClientDocument_organizationId_clientId_documentType_status_idx" ON "ClientDocument"("organizationId", "clientId", "documentType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoiAuthorization_documentId_key" ON "RoiAuthorization"("documentId");

-- CreateIndex
CREATE INDEX "RoiAuthorization_organizationId_clientId_status_expirationD_idx" ON "RoiAuthorization"("organizationId", "clientId", "status", "expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureEnvelope_documentId_key" ON "SignatureEnvelope"("documentId");

-- CreateIndex
CREATE INDEX "SignatureEnvelope_organizationId_clientId_status_idx" ON "SignatureEnvelope"("organizationId", "clientId", "status");

-- CreateIndex
CREATE INDEX "SignatureSigner_envelopeId_status_idx" ON "SignatureSigner"("envelopeId", "status");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientService" ADD CONSTRAINT "ClientService_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalContact" ADD CONSTRAINT "ProfessionalContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfessionalContact" ADD CONSTRAINT "ClientProfessionalContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfessionalContact" ADD CONSTRAINT "ClientProfessionalContact_professionalContactId_fkey" FOREIGN KEY ("professionalContactId") REFERENCES "ProfessionalContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRepresentative" ADD CONSTRAINT "ClientRepresentative_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEmergencyContact" ADD CONSTRAINT "ClientEmergencyContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHealthProfile" ADD CONSTRAINT "ClientHealthProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMedication" ADD CONSTRAINT "ClientMedication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntake" ADD CONSTRAINT "ClientIntake_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntakeChecklistItem" ADD CONSTRAINT "ClientIntakeChecklistItem_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "ClientIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocumentTemplate" ADD CONSTRAINT "ClientDocumentTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "ClientIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClientDocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoiAuthorization" ADD CONSTRAINT "RoiAuthorization_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoiAuthorization" ADD CONSTRAINT "RoiAuthorization_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEnvelope" ADD CONSTRAINT "SignatureEnvelope_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureSigner" ADD CONSTRAINT "SignatureSigner_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed additive client permissions and grant them to existing organization owners.
INSERT INTO "Permission" ("id", "code", "description", "createdAt") VALUES
  ('client-perm-read', 'client.read', 'View organization client records', CURRENT_TIMESTAMP),
  ('client-perm-create', 'client.create', 'Create organization client records', CURRENT_TIMESTAMP),
  ('client-perm-update', 'client.update', 'Update organization client records', CURRENT_TIMESTAMP),
  ('client-perm-intake', 'client.intake.manage', 'Manage client intake workflows', CURRENT_TIMESTAMP),
  ('client-perm-doc-read', 'client.document.read', 'View client documents', CURRENT_TIMESTAMP),
  ('client-perm-doc-generate', 'client.document.generate', 'Generate and finalize client documents', CURRENT_TIMESTAMP),
  ('client-perm-signature', 'client.signature.manage', 'Manage client signature workflows', CURRENT_TIMESTAMP),
  ('client-perm-export', 'client.export', 'Export client document packets', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT 'client-rp-' || md5(r."id" || p."id"), r."id", p."id", CURRENT_TIMESTAMP
FROM "RoleDefinition" r CROSS JOIN "Permission" p
WHERE r."code" = 'ORGANIZATION_OWNER' AND p."code" LIKE 'client.%'
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;

-- Platform defaults are versioned definitions, not tenant-specific client data.
INSERT INTO "ClientDocumentTemplate" ("id", "organizationId", "code", "name", "documentType", "versionNumber", "status", "contentJson", "effectiveFrom", "createdAt") VALUES
  ('client-template-checklist-v1', NULL, '00-INTAKE-CHECKLIST', 'Intake Checklist - Staff Use', 'INTAKE_CHECKLIST', 1, 'ACTIVE', '{"sections":["referral and records","funding and authorization","required acknowledgments","operational milestones","staff and manager review"],"missingFormsNotInvented":["03","05","06","07","08"]}', NULL, CURRENT_TIMESTAMP),
  ('client-template-face-v1', NULL, '01-FACE-SHEET', 'Client Information / Face Sheet', 'FACE_SHEET', 1, 'ACTIVE', '{"source":"structured-client-data","signerRoles":["CLIENT_OR_LEGAL_REPRESENTATIVE","ORGANIZATION_STAFF"]}', NULL, CURRENT_TIMESTAMP),
  ('client-template-rights-v1', NULL, '02-RIGHTS', 'Service Recipient Rights Acknowledgment', 'RIGHTS_ACKNOWLEDGMENT', 1, 'ACTIVE', '{"versionedRightsContent":true,"tracks":["writtenCopyReceivedDate","rightsExplainedDate","explanationMethod","annualReviewDate"],"signerRoles":["CLIENT","LEGAL_REPRESENTATIVE_IF_APPLICABLE","ORGANIZATION_STAFF"]}', NULL, CURRENT_TIMESTAMP),
  ('client-template-roi-v1', NULL, '04-ROI', 'Authorization to Release Information', 'ROI', 1, 'ACTIVE', '{"repeatable":true,"maximumDurationYears":1,"signerRoles":["CLIENT","LEGAL_REPRESENTATIVE_IF_APPLICABLE","ORGANIZATION_STAFF"]}', NULL, CURRENT_TIMESTAMP);
