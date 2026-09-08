-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TrainingCourseVersionStatus" ADD VALUE 'IN_REVIEW';
ALTER TYPE "TrainingCourseVersionStatus" ADD VALUE 'APPROVED';
ALTER TYPE "TrainingCourseVersionStatus" ADD VALUE 'ACTIVE';
ALTER TYPE "TrainingCourseVersionStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "questionBankVersionId" TEXT;

-- AlterTable
ALTER TABLE "AssessmentQuestion" ADD COLUMN     "critical" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "questionBankVersionId" TEXT,
ADD COLUMN     "remediationContentItemId" TEXT;

-- CreateTable
CREATE TABLE "LearningObjective" (
    "id" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "assessmentRequired" BOOLEAN NOT NULL DEFAULT true,
    "criticalSafety" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObjectiveRequirement" (
    "id" TEXT NOT NULL,
    "learningObjectiveId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningObjectiveRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObjectiveModule" (
    "id" TEXT NOT NULL,
    "learningObjectiveId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningObjectiveModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObjectiveContent" (
    "id" TEXT NOT NULL,
    "learningObjectiveId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningObjectiveContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningObjectiveQuestion" (
    "id" TEXT NOT NULL,
    "learningObjectiveId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningObjectiveQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModuleSubjectArea" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "subjectAreaCode" TEXT NOT NULL,
    "subjectAreaName" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingModuleSubjectArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionBank" (
    "id" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionBankVersion" (
    "id" TEXT NOT NULL,
    "questionBankId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "TrainingCourseVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionBankVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningObjective_code_idx" ON "LearningObjective"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LearningObjective_courseVersionId_code_key" ON "LearningObjective"("courseVersionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LearningObjectiveRequirement_learningObjectiveId_requiremen_key" ON "LearningObjectiveRequirement"("learningObjectiveId", "requirementVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningObjectiveModule_learningObjectiveId_moduleId_key" ON "LearningObjectiveModule"("learningObjectiveId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningObjectiveContent_learningObjectiveId_contentItemId_key" ON "LearningObjectiveContent"("learningObjectiveId", "contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningObjectiveQuestion_learningObjectiveId_questionId_key" ON "LearningObjectiveQuestion"("learningObjectiveId", "questionId");

-- CreateIndex
CREATE INDEX "TrainingModuleSubjectArea_subjectAreaCode_idx" ON "TrainingModuleSubjectArea"("subjectAreaCode");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingModuleSubjectArea_moduleId_subjectAreaCode_key" ON "TrainingModuleSubjectArea"("moduleId", "subjectAreaCode");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBank_courseVersionId_code_key" ON "QuestionBank"("courseVersionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBankVersion_questionBankId_versionNumber_key" ON "QuestionBankVersion"("questionBankId", "versionNumber");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_questionBankVersionId_fkey" FOREIGN KEY ("questionBankVersionId") REFERENCES "QuestionBankVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_questionBankVersionId_fkey" FOREIGN KEY ("questionBankVersionId") REFERENCES "QuestionBankVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjective" ADD CONSTRAINT "LearningObjective_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveRequirement" ADD CONSTRAINT "LearningObjectiveRequirement_learningObjectiveId_fkey" FOREIGN KEY ("learningObjectiveId") REFERENCES "LearningObjective"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveRequirement" ADD CONSTRAINT "LearningObjectiveRequirement_requirementVersionId_fkey" FOREIGN KEY ("requirementVersionId") REFERENCES "ComplianceRequirementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveModule" ADD CONSTRAINT "LearningObjectiveModule_learningObjectiveId_fkey" FOREIGN KEY ("learningObjectiveId") REFERENCES "LearningObjective"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveModule" ADD CONSTRAINT "LearningObjectiveModule_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveContent" ADD CONSTRAINT "LearningObjectiveContent_learningObjectiveId_fkey" FOREIGN KEY ("learningObjectiveId") REFERENCES "LearningObjective"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveContent" ADD CONSTRAINT "LearningObjectiveContent_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "TrainingContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveQuestion" ADD CONSTRAINT "LearningObjectiveQuestion_learningObjectiveId_fkey" FOREIGN KEY ("learningObjectiveId") REFERENCES "LearningObjective"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningObjectiveQuestion" ADD CONSTRAINT "LearningObjectiveQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "AssessmentQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingModuleSubjectArea" ADD CONSTRAINT "TrainingModuleSubjectArea_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionBank" ADD CONSTRAINT "QuestionBank_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionBankVersion" ADD CONSTRAINT "QuestionBankVersion_questionBankId_fkey" FOREIGN KEY ("questionBankId") REFERENCES "QuestionBank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
