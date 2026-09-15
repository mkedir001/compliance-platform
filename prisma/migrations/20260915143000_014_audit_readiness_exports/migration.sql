-- Phase 12 adds immutable export snapshots and a bounded material-audit-event index.
-- Existing compliance evidence tables are neither rewritten nor deleted.
CREATE TYPE "AuditPackageScope" AS ENUM ('EMPLOYEE_COMPLIANCE_RECORD', 'REQUIREMENT_EVIDENCE_RECORD', 'ORGANIZATION_COMPLIANCE_SUMMARY');
CREATE TYPE "AuditPackageStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED');

CREATE TABLE "AuditPackage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "AuditPackageScope" NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "pointInTimeAt" TIMESTAMP(3),
    "status" "AuditPackageStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedAt" TIMESTAMP(3),
    "manifestJson" JSONB,
    "integrityDigest" TEXT,
    "generationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "employeeId" TEXT,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadataJson" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditPackage_organizationId_requestedAt_idx" ON "AuditPackage"("organizationId", "requestedAt");
CREATE INDEX "AuditPackage_organizationId_scope_status_idx" ON "AuditPackage"("organizationId", "scope", "status");
CREATE INDEX "AuditPackage_organizationId_subjectType_subjectId_idx" ON "AuditPackage"("organizationId", "subjectType", "subjectId");
CREATE INDEX "AuditEvent_organizationId_occurredAt_idx" ON "AuditEvent"("organizationId", "occurredAt");
CREATE INDEX "AuditEvent_organizationId_employeeId_occurredAt_idx" ON "AuditEvent"("organizationId", "employeeId", "occurredAt");
CREATE INDEX "AuditEvent_organizationId_actorUserId_occurredAt_idx" ON "AuditEvent"("organizationId", "actorUserId", "occurredAt");
CREATE INDEX "AuditEvent_organizationId_eventType_occurredAt_idx" ON "AuditEvent"("organizationId", "eventType", "occurredAt");
CREATE INDEX "AuditEvent_organizationId_entityType_entityId_occurredAt_idx" ON "AuditEvent"("organizationId", "entityType", "entityId", "occurredAt");

ALTER TABLE "AuditPackage" ADD CONSTRAINT "AuditPackage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditPackage" ADD CONSTRAINT "AuditPackage_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
