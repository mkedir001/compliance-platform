-- CreateEnum
CREATE TYPE "TrainingCourseStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrainingOwnershipType" AS ENUM ('PLATFORM', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "TrainingCourseVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "TrainingModuleType" AS ENUM ('CONTENT', 'ASSESSMENT', 'MIXED');

-- CreateEnum
CREATE TYPE "TrainingContentType" AS ENUM ('RICH_TEXT', 'WRITTEN', 'VIDEO', 'DOCUMENT_REFERENCE', 'ACKNOWLEDGMENT', 'ASSESSMENT', 'EXTERNAL_RESOURCE');

-- CreateEnum
CREATE TYPE "TrainingSatisfactionType" AS ENUM ('TRAINING_ONLY', 'TRAINING_AND_COMPETENCY', 'ALTERNATIVE');

-- CreateEnum
CREATE TYPE "TrainingAssignmentSource" AS ENUM ('COMPLIANCE_ENGINE', 'MANUAL', 'ORGANIZATION_POLICY', 'ADMINISTRATOR');

-- CreateEnum
CREATE TYPE "TrainingProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'LOCKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TrainingAssignmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'TRAINING_COMPLETE_COMPETENCY_PENDING', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssessmentQuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "TrainingCompletionMethod" AS ENUM ('COURSEWORK');

-- CreateTable
CREATE TABLE "TrainingCourse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "catalogKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "status" "TrainingCourseStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownershipType" "TrainingOwnershipType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCourseVersion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "TrainingCourseVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "publishedAt" TIMESTAMP(3),
    "estimatedDurationMinutes" INTEGER,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingCourseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModule" (
    "id" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "moduleType" "TrainingModuleType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "estimatedDurationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingContentItem" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "contentType" "TrainingContentType" NOT NULL,
    "payload" JSONB NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementTrainingOption" (
    "id" TEXT NOT NULL,
    "complianceRequirementVersionId" TEXT NOT NULL,
    "trainingCourseVersionId" TEXT NOT NULL,
    "satisfactionType" "TrainingSatisfactionType" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE,
    "effectiveUntil" DATE,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementTrainingOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAssignment" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "sourceType" "TrainingAssignmentSource" NOT NULL,
    "sourceReferenceId" TEXT,
    "complianceInstanceId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "status" "TrainingAssignmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "assignedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModuleProgress" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "status" "TrainingProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingModuleProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingContentProgress" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "status" "TrainingProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingContentProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAcknowledgment" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "acknowledgedByUserId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "passingScore" DECIMAL(5,2) NOT NULL,
    "maxAttempts" INTEGER,
    "randomizeQuestions" BOOLEAN NOT NULL DEFAULT false,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentQuestion" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionType" "AssessmentQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "explanation" TEXT,
    "sequence" INTEGER NOT NULL,
    "points" DECIMAL(8,2) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "trainingAssignmentId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "score" DECIMAL(8,2),
    "maxScore" DECIMAL(8,2),
    "percentage" DECIMAL(5,2),
    "passed" BOOLEAN,
    "resultSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResponse" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOptionIds" JSONB NOT NULL,
    "awardedPoints" DECIMAL(8,2) NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCompletion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "completionMethod" "TrainingCompletionMethod" NOT NULL,
    "finalAssessmentAttemptId" TEXT,
    "evidenceSnapshotJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCourse_catalogKey_key" ON "TrainingCourse"("catalogKey");

-- CreateIndex
CREATE INDEX "TrainingCourse_organizationId_status_idx" ON "TrainingCourse"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCourse_organizationId_code_key" ON "TrainingCourse"("organizationId", "code");

-- CreateIndex
CREATE INDEX "TrainingCourseVersion_status_effectiveFrom_effectiveUntil_idx" ON "TrainingCourseVersion"("status", "effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCourseVersion_courseId_versionNumber_key" ON "TrainingCourseVersion"("courseId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingModule_courseVersionId_sequence_key" ON "TrainingModule"("courseVersionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingContentItem_moduleId_sequence_key" ON "TrainingContentItem"("moduleId", "sequence");

-- CreateIndex
CREATE INDEX "RequirementTrainingOption_complianceRequirementVersionId_is_idx" ON "RequirementTrainingOption"("complianceRequirementVersionId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementTrainingOption_complianceRequirementVersionId_tr_key" ON "RequirementTrainingOption"("complianceRequirementVersionId", "trainingCourseVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingAssignment_fingerprint_key" ON "TrainingAssignment"("fingerprint");

-- CreateIndex
CREATE INDEX "TrainingAssignment_organizationId_employeeId_status_idx" ON "TrainingAssignment"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "TrainingAssignment_complianceInstanceId_idx" ON "TrainingAssignment"("complianceInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingModuleProgress_assignmentId_moduleId_key" ON "TrainingModuleProgress"("assignmentId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingContentProgress_assignmentId_contentItemId_key" ON "TrainingContentProgress"("assignmentId", "contentItemId");

-- CreateIndex
CREATE INDEX "TrainingAcknowledgment_employeeId_idx" ON "TrainingAcknowledgment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingAcknowledgment_assignmentId_contentItemId_key" ON "TrainingAcknowledgment"("assignmentId", "contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_moduleId_versionNumber_key" ON "Assessment"("moduleId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentQuestion_assessmentId_sequence_key" ON "AssessmentQuestion"("assessmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentOption_questionId_sequence_key" ON "AssessmentOption"("questionId", "sequence");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_organizationId_employeeId_idx" ON "AssessmentAttempt"("organizationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAttempt_trainingAssignmentId_assessmentId_attempt_key" ON "AssessmentAttempt"("trainingAssignmentId", "assessmentId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResponse_attemptId_questionId_key" ON "AssessmentResponse"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCompletion_assignmentId_key" ON "TrainingCompletion"("assignmentId");

-- CreateIndex
CREATE INDEX "TrainingCompletion_organizationId_employeeId_completedAt_idx" ON "TrainingCompletion"("organizationId", "employeeId", "completedAt");

-- AddForeignKey
ALTER TABLE "TrainingCourse" ADD CONSTRAINT "TrainingCourse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCourseVersion" ADD CONSTRAINT "TrainingCourseVersion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainingCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModule" ADD CONSTRAINT "TrainingModule_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingContentItem" ADD CONSTRAINT "TrainingContentItem_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTrainingOption" ADD CONSTRAINT "RequirementTrainingOption_complianceRequirementVersionId_fkey" FOREIGN KEY ("complianceRequirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementTrainingOption" ADD CONSTRAINT "RequirementTrainingOption_trainingCourseVersionId_fkey" FOREIGN KEY ("trainingCourseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_complianceInstanceId_fkey" FOREIGN KEY ("complianceInstanceId") REFERENCES "ComplianceInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModuleProgress" ADD CONSTRAINT "TrainingModuleProgress_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModuleProgress" ADD CONSTRAINT "TrainingModuleProgress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingContentProgress" ADD CONSTRAINT "TrainingContentProgress_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingContentProgress" ADD CONSTRAINT "TrainingContentProgress_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "TrainingContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAcknowledgment" ADD CONSTRAINT "TrainingAcknowledgment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAcknowledgment" ADD CONSTRAINT "TrainingAcknowledgment_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "TrainingContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAcknowledgment" ADD CONSTRAINT "TrainingAcknowledgment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAcknowledgment" ADD CONSTRAINT "TrainingAcknowledgment_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentOption" ADD CONSTRAINT "AssessmentOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "AssessmentQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "AssessmentResponse_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "AssessmentResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "AssessmentQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCompletion" ADD CONSTRAINT "TrainingCompletion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCompletion" ADD CONSTRAINT "TrainingCompletion_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCompletion" ADD CONSTRAINT "TrainingCompletion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCompletion" ADD CONSTRAINT "TrainingCompletion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainingCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCompletion" ADD CONSTRAINT "TrainingCompletion_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCompletion" ADD CONSTRAINT "TrainingCompletion_finalAssessmentAttemptId_fkey" FOREIGN KEY ("finalAssessmentAttemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
