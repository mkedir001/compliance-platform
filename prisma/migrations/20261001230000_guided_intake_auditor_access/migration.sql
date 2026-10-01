-- Additive, fail-closed temporary auditor access. Existing roles and grants are not changed.
CREATE TYPE "AuditAccessStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "AuditAccessCategory" AS ENUM ('CLIENTS', 'CLIENT_DOCUMENTS', 'STAFF', 'TRAINING_COMPLIANCE', 'CREDENTIALS_COMPETENCIES', 'POLICIES', 'EVIDENCE', 'AUDIT_PACKAGES');

CREATE TABLE "AuditAccessSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inspectorName" TEXT,
    "inspectorEmail" TEXT NOT NULL,
    "inspectorUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "AuditAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "categories" "AuditAccessCategory"[] NOT NULL,
    "includeActiveStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuditAccessSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditAccessClient" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditAccessClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditAccessEmployee" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditAccessEmployee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditAccessSession_organizationId_status_startsAt_expiresAt_idx" ON "AuditAccessSession"("organizationId", "status", "startsAt", "expiresAt");
CREATE INDEX "AuditAccessSession_inspectorUserId_status_startsAt_expiresAt_idx" ON "AuditAccessSession"("inspectorUserId", "status", "startsAt", "expiresAt");
CREATE UNIQUE INDEX "AuditAccessClient_sessionId_clientId_key" ON "AuditAccessClient"("sessionId", "clientId");
CREATE INDEX "AuditAccessClient_clientId_idx" ON "AuditAccessClient"("clientId");
CREATE UNIQUE INDEX "AuditAccessEmployee_sessionId_employeeId_key" ON "AuditAccessEmployee"("sessionId", "employeeId");
CREATE INDEX "AuditAccessEmployee_employeeId_idx" ON "AuditAccessEmployee"("employeeId");

ALTER TABLE "AuditAccessSession" ADD CONSTRAINT "AuditAccessSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditAccessSession" ADD CONSTRAINT "AuditAccessSession_inspectorUserId_fkey" FOREIGN KEY ("inspectorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditAccessSession" ADD CONSTRAINT "AuditAccessSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditAccessSession" ADD CONSTRAINT "AuditAccessSession_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditAccessClient" ADD CONSTRAINT "AuditAccessClient_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuditAccessSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditAccessClient" ADD CONSTRAINT "AuditAccessClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditAccessEmployee" ADD CONSTRAINT "AuditAccessEmployee_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuditAccessSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditAccessEmployee" ADD CONSTRAINT "AuditAccessEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "code", "description", "createdAt")
VALUES
  ('permission_audit_session_manage', 'audit.session.manage', 'Create, scope, and revoke temporary auditor access sessions', CURRENT_TIMESTAMP),
  ('permission_audit_portal_read', 'audit.portal.read', 'Use an active explicitly scoped read-only auditor session', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
