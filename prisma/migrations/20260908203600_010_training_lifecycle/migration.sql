-- AlterEnum
ALTER TYPE "TrainingAssignmentStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "AssessmentAttempt" ADD COLUMN "courseVersionId" TEXT;

-- AlterTable
ALTER TABLE "TrainingAssignment"
ADD COLUMN "activeKey" TEXT,
ADD COLUMN "cancellationReason" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledByUserId" TEXT;

-- CreateTable
CREATE TABLE "TrainingAssignmentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingAssignmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingAssignmentEvent_organizationId_assignmentId_created_idx" ON "TrainingAssignmentEvent"("organizationId", "assignmentId", "createdAt");
CREATE INDEX "TrainingAssignmentEvent_eventType_createdAt_idx" ON "TrainingAssignmentEvent"("eventType", "createdAt");
CREATE UNIQUE INDEX "TrainingAssignment_activeKey_key" ON "TrainingAssignment"("activeKey");

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingAssignmentEvent" ADD CONSTRAINT "TrainingAssignmentEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingAssignmentEvent" ADD CONSTRAINT "TrainingAssignmentEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingAssignmentEvent" ADD CONSTRAINT "TrainingAssignmentEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_courseVersionId_fkey" FOREIGN KEY ("courseVersionId") REFERENCES "TrainingCourseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
