-- Additive referral management and reviewed client-plan questionnaire foundation.
CREATE TYPE "ReferralFormStatus" AS ENUM ('DRAFT','SENT','IN_PROGRESS','SUBMITTED','EXPIRED','REVOKED');
CREATE TYPE "ReferralDispositionStatus" AS ENUM ('PENDING_REVIEW','UNDER_REVIEW','INTAKE_STARTED','ACCEPTED','DECLINED','CLOSED');
CREATE TYPE "ReferralAccessStatus" AS ENUM ('ACTIVE','REVOKED','EXPIRED','REPLACED','USED');
CREATE TYPE "ReferralSource" AS ENUM ('EXTERNAL_FORM','UPLOADED_PDF');
CREATE TYPE "ReferralProposalState" AS ENUM ('PROPOSED','ACCEPTED','CORRECTED','REJECTED');
CREATE TYPE "DocumentQuestionnaireStatus" AS ENUM ('DRAFT','READY_FOR_REVIEW','GENERATED','CANCELED');

CREATE TABLE "Referral" (
 "id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"createdByUserId" TEXT NOT NULL,"reviewedByUserId" TEXT,"recipientName" TEXT NOT NULL,"recipientEmail" TEXT,
 "formStatus" "ReferralFormStatus" NOT NULL DEFAULT 'DRAFT',"dispositionStatus" "ReferralDispositionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',"source" "ReferralSource" NOT NULL DEFAULT 'EXTERNAL_FORM',
 "draftAnswersJson" JSONB,"sentAt" TIMESTAMP(3),"firstViewedAt" TIMESTAMP(3),"submittedAt" TIMESTAMP(3),"reviewedAt" TIMESTAMP(3),"acceptedAt" TIMESTAMP(3),"declinedAt" TIMESTAMP(3),"closedAt" TIMESTAMP(3),"linkedClientId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReferralAccessToken" (
 "id" TEXT NOT NULL,"referralId" TEXT NOT NULL,"tokenHash" TEXT NOT NULL,"status" "ReferralAccessStatus" NOT NULL DEFAULT 'ACTIVE',"expiresAt" TIMESTAMP(3) NOT NULL,"issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"firstUsedAt" TIMESTAMP(3),"lastUsedAt" TIMESTAMP(3),"revokedAt" TIMESTAMP(3),"reminderCount" INTEGER NOT NULL DEFAULT 0,"lastReminderAt" TIMESTAMP(3),"replacedById" TEXT,
 CONSTRAINT "ReferralAccessToken_pkey" PRIMARY KEY ("id"),CONSTRAINT "ReferralAccessToken_expiration_check" CHECK ("expiresAt">"issuedAt"),CONSTRAINT "ReferralAccessToken_reminder_count_check" CHECK ("reminderCount">=0)
);
CREATE TABLE "ReferralSubmission" (
 "id" TEXT NOT NULL,"referralId" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"answersJson" JSONB NOT NULL,"submittedPdf" BYTEA NOT NULL,"sha256" TEXT NOT NULL,"originalFileName" TEXT,"source" "ReferralSource" NOT NULL,"clientDocumentId" TEXT,"submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ReferralSubmission_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReferralIntakeDraft" (
 "id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"referralId" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',"proposedFieldsJson" JSONB NOT NULL,"provenanceJson" JSONB NOT NULL,"possibleClientIdsJson" JSONB NOT NULL,"resolvedClientId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ReferralIntakeDraft_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReferralProposal" (
 "id" TEXT NOT NULL,"referralId" TEXT NOT NULL,"fieldPath" TEXT NOT NULL,"proposedValue" JSONB NOT NULL,"correctedValue" JSONB,"confidence" DOUBLE PRECISION,"sourceLocation" TEXT,"state" "ReferralProposalState" NOT NULL DEFAULT 'PROPOSED',"reviewedByUserId" TEXT,"reviewedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ReferralProposal_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReferralEvent" (
 "id" TEXT NOT NULL,"referralId" TEXT NOT NULL,"actorUserId" TEXT,"eventType" TEXT NOT NULL,"metadataJson" JSONB,"occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClientDocumentQuestionnaire" (
 "id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"clientId" TEXT NOT NULL,"templateId" TEXT NOT NULL,"documentType" "ClientDocumentType" NOT NULL,"pathway" TEXT,"status" "DocumentQuestionnaireStatus" NOT NULL DEFAULT 'DRAFT',"answersJson" JSONB NOT NULL,"sourcesJson" JSONB NOT NULL,"missingFieldsJson" JSONB NOT NULL,"conflictsJson" JSONB NOT NULL,"careProposalsJson" JSONB NOT NULL,"priorDocumentId" TEXT,"generatedDocumentId" TEXT,"createdByUserId" TEXT NOT NULL,"reviewedByUserId" TEXT,"reviewedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ClientDocumentQuestionnaire_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralAccessToken_tokenHash_key" ON "ReferralAccessToken"("tokenHash");
CREATE UNIQUE INDEX "ReferralAccessToken_replacedById_key" ON "ReferralAccessToken"("replacedById");
CREATE UNIQUE INDEX "ReferralSubmission_referralId_key" ON "ReferralSubmission"("referralId");
CREATE UNIQUE INDEX "ReferralSubmission_idempotencyKey_key" ON "ReferralSubmission"("idempotencyKey");
CREATE UNIQUE INDEX "ReferralSubmission_clientDocumentId_key" ON "ReferralSubmission"("clientDocumentId");
CREATE UNIQUE INDEX "ReferralIntakeDraft_referralId_key" ON "ReferralIntakeDraft"("referralId");
CREATE UNIQUE INDEX "ReferralProposal_referralId_fieldPath_key" ON "ReferralProposal"("referralId","fieldPath");
CREATE UNIQUE INDEX "ClientDocumentQuestionnaire_generatedDocumentId_key" ON "ClientDocumentQuestionnaire"("generatedDocumentId");
CREATE INDEX "Referral_organizationId_formStatus_dispositionStatus_updatedAt_idx" ON "Referral"("organizationId","formStatus","dispositionStatus","updatedAt");
CREATE INDEX "Referral_organizationId_recipientEmail_idx" ON "Referral"("organizationId","recipientEmail");
CREATE INDEX "Referral_organizationId_linkedClientId_idx" ON "Referral"("organizationId","linkedClientId");
CREATE INDEX "ReferralAccessToken_referralId_status_expiresAt_idx" ON "ReferralAccessToken"("referralId","status","expiresAt");
CREATE INDEX "ReferralIntakeDraft_organizationId_status_updatedAt_idx" ON "ReferralIntakeDraft"("organizationId","status","updatedAt");
CREATE INDEX "ReferralProposal_referralId_state_idx" ON "ReferralProposal"("referralId","state");
CREATE INDEX "ReferralEvent_referralId_occurredAt_idx" ON "ReferralEvent"("referralId","occurredAt");
CREATE INDEX "ClientDocumentQuestionnaire_organizationId_clientId_documentType_status_idx" ON "ClientDocumentQuestionnaire"("organizationId","clientId","documentType","status");

ALTER TABLE "Referral" ADD CONSTRAINT "Referral_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_linkedClientId_fkey" FOREIGN KEY ("linkedClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAccessToken" ADD CONSTRAINT "ReferralAccessToken_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralAccessToken" ADD CONSTRAINT "ReferralAccessToken_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "ReferralAccessToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralSubmission" ADD CONSTRAINT "ReferralSubmission_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralSubmission" ADD CONSTRAINT "ReferralSubmission_clientDocumentId_fkey" FOREIGN KEY ("clientDocumentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralIntakeDraft" ADD CONSTRAINT "ReferralIntakeDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralIntakeDraft" ADD CONSTRAINT "ReferralIntakeDraft_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralIntakeDraft" ADD CONSTRAINT "ReferralIntakeDraft_resolvedClientId_fkey" FOREIGN KEY ("resolvedClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralProposal" ADD CONSTRAINT "ReferralProposal_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralEvent" ADD CONSTRAINT "ReferralEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentQuestionnaire" ADD CONSTRAINT "ClientDocumentQuestionnaire_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentQuestionnaire" ADD CONSTRAINT "ClientDocumentQuestionnaire_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentQuestionnaire" ADD CONSTRAINT "ClientDocumentQuestionnaire_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ClientDocumentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentQuestionnaire" ADD CONSTRAINT "ClientDocumentQuestionnaire_generatedDocumentId_fkey" FOREIGN KEY ("generatedDocumentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentQuestionnaire" ADD CONSTRAINT "ClientDocumentQuestionnaire_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientDocumentQuestionnaire" ADD CONSTRAINT "ClientDocumentQuestionnaire_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("id","code","description","createdAt") VALUES ('permission-client-referral-manage','client.referral.manage','Create, send, review, and resolve organization referrals',CURRENT_TIMESTAMP) ON CONFLICT ("code") DO NOTHING;
INSERT INTO "RolePermission" ("id","roleDefinitionId","permissionId","createdAt")
SELECT 'role-referral-' || md5(rp."roleDefinitionId"),rp."roleDefinitionId",p."id",CURRENT_TIMESTAMP
FROM "RolePermission" rp JOIN "Permission" existing ON existing."id"=rp."permissionId" AND existing."code"='client.intake.manage' CROSS JOIN "Permission" p
WHERE p."code"='client.referral.manage' ON CONFLICT ("roleDefinitionId","permissionId") DO NOTHING;

INSERT INTO "ClientDocumentTemplate" ("id","organizationId","code","name","documentType","versionNumber","status","contentJson","renewalPolicy","renewalWarningDays","createdAt") VALUES
('client-template-cssp-basic-v1',NULL,'MN-DPF-016B','CSSP Addendum — Basic Support Services','CSSP_ADDENDUM',1,'ACTIVE','{"renderer":"WALDAH_STRUCTURED_PLAN_V1","pathway":"BASIC","source":"DPF-016B","requiredByDefault":false,"signerRoles":["CLIENT_OR_LEGAL_REPRESENTATIVE","CASE_MANAGER","ORGANIZATION_STAFF"]}'::jsonb,'ANNUAL',30,CURRENT_TIMESTAMP),
('client-template-cssp-intensive-v1',NULL,'MN-DPF-016A','CSSP Addendum — Intensive Services','CSSP_ADDENDUM',2,'ACTIVE','{"renderer":"WALDAH_STRUCTURED_PLAN_V1","pathway":"INTENSIVE","source":"DPF-016A","requiredByDefault":false,"signerRoles":["CLIENT_OR_LEGAL_REPRESENTATIVE","CASE_MANAGER","ORGANIZATION_STAFF"]}'::jsonb,'ANNUAL',30,CURRENT_TIMESTAMP),
('client-template-iapp-v1',NULL,'MN-IAPP','Individual Abuse Prevention Plan (IAPP)','IAPP',1,'ACTIVE','{"renderer":"WALDAH_STRUCTURED_PLAN_V1","source":"standard-IAPP","requiredByDefault":false,"signerRoles":["CLIENT_OR_LEGAL_REPRESENTATIVE","ORGANIZATION_STAFF"]}'::jsonb,'ANNUAL',30,CURRENT_TIMESTAMP),
('client-template-referral-v1',NULL,'RADIANT-REFERRAL','Referral Form','REFERRAL_FORM',1,'ACTIVE','{"renderer":"WALDAH_REFERRAL_V1","externalForm":true,"immutableSubmission":true,"requiredByDefault":false}'::jsonb,'NONE',30,CURRENT_TIMESTAMP)
ON CONFLICT ("organizationId","code","versionNumber") DO NOTHING;
