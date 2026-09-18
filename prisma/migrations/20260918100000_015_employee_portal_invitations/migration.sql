-- Phase 13 adds invitation/claim metadata only. Existing employee and evidence records are unchanged.
CREATE TYPE "EmployeePortalInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

CREATE TABLE "EmployeePortalInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "invitedEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "EmployeePortalInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeePortalInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeePortalInvitation_tokenHash_key" ON "EmployeePortalInvitation"("tokenHash");
CREATE INDEX "EmployeePortalInvitation_organizationId_employeeId_invitedAt_idx" ON "EmployeePortalInvitation"("organizationId", "employeeId", "invitedAt");
CREATE INDEX "EmployeePortalInvitation_organizationId_invitedEmail_status_idx" ON "EmployeePortalInvitation"("organizationId", "invitedEmail", "status");

ALTER TABLE "EmployeePortalInvitation" ADD CONSTRAINT "EmployeePortalInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeePortalInvitation" ADD CONSTRAINT "EmployeePortalInvitation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeePortalInvitation" ADD CONSTRAINT "EmployeePortalInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeePortalInvitation" ADD CONSTRAINT "EmployeePortalInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
