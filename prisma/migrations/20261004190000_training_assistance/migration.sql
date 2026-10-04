CREATE TABLE "AssessmentDraftResponse" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "selectedOptionIds" JSONB NOT NULL,
    "savedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssessmentDraftResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssessmentDraftResponse_attemptId_questionId_key"
ON "AssessmentDraftResponse"("attemptId", "questionId");

CREATE INDEX "AssessmentDraftResponse_attemptId_updatedAt_idx"
ON "AssessmentDraftResponse"("attemptId", "updatedAt");

ALTER TABLE "AssessmentDraftResponse"
ADD CONSTRAINT "AssessmentDraftResponse_attemptId_fkey"
FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssessmentDraftResponse"
ADD CONSTRAINT "AssessmentDraftResponse_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "AssessmentQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
