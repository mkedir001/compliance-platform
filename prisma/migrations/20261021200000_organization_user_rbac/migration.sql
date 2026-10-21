CREATE TYPE "PermissionEffect" AS ENUM ('GRANT', 'DENY');
CREATE TYPE "OrganizationInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

CREATE TABLE "MembershipPermission" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  "effect" "PermissionEffect" NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipPermission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MembershipPermission_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MembershipPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MembershipPermission_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MembershipPermission_membershipId_permissionId_key" ON "MembershipPermission"("membershipId", "permissionId");
CREATE INDEX "MembershipPermission_permissionId_effect_idx" ON "MembershipPermission"("permissionId", "effect");

CREATE TABLE "OrganizationUserInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invitedEmail" TEXT NOT NULL,
  "displayName" TEXT,
  "tokenHash" TEXT NOT NULL,
  "status" "OrganizationInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "roleDefinitionId" TEXT,
  "permissionCodes" JSONB,
  "employeeId" TEXT,
  "invitedByUserId" TEXT NOT NULL,
  "acceptedByUserId" TEXT,
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OrganizationUserInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationUserInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationUserInvitation_roleDefinitionId_fkey" FOREIGN KEY ("roleDefinitionId") REFERENCES "RoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationUserInvitation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationUserInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationUserInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrganizationUserInvitation_tokenHash_key" ON "OrganizationUserInvitation"("tokenHash");
CREATE INDEX "OrganizationUserInvitation_organizationId_status_invitedAt_idx" ON "OrganizationUserInvitation"("organizationId", "status", "invitedAt");
CREATE INDEX "OrganizationUserInvitation_organizationId_invitedEmail_status_idx" ON "OrganizationUserInvitation"("organizationId", "invitedEmail", "status");

INSERT INTO "Permission" ("id", "code", "description", "createdAt") VALUES
  (md5('permission:user.read'), 'user.read', 'View organization users and effective permissions', CURRENT_TIMESTAMP),
  (md5('permission:user.invite'), 'user.invite', 'Invite organization users', CURRENT_TIMESTAMP),
  (md5('permission:user.manage'), 'user.manage', 'Manage organization memberships and roles', CURRENT_TIMESTAMP),
  (md5('permission:permission.manage'), 'permission.manage', 'Manage delegated organization permissions', CURRENT_TIMESTAMP),
  (md5('permission:employee.self.read'), 'employee.self.read', 'View the linked employee profile', CURRENT_TIMESTAMP),
  (md5('permission:client.assigned.read'), 'client.assigned.read', 'View assigned clients', CURRENT_TIMESTAMP),
  (md5('permission:client.caregiver.read'), 'client.caregiver.read', 'View the minimum necessary caregiver client projection', CURRENT_TIMESTAMP),
  (md5('permission:medication.assigned.read'), 'medication.assigned.read', 'View assigned-client medication instructions', CURRENT_TIMESTAMP),
  (md5('permission:medication.activity.record'), 'medication.activity.record', 'Record separately authorized medication activity', CURRENT_TIMESTAMP),
  (md5('permission:billing.view'), 'billing.view', 'View billing readiness and permitted billing information', CURRENT_TIMESTAMP),
  (md5('permission:billing.initiate'), 'billing.initiate', 'Initiate supported billing operations', CURRENT_TIMESTAMP),
  (md5('permission:billing.mapping.manage'), 'billing.mapping.manage', 'Manage AxisCare billing mappings', CURRENT_TIMESTAMP),
  (md5('permission:billing.sync.manage'), 'billing.sync.manage', 'Manage AxisCare synchronization', CURRENT_TIMESTAMP),
  (md5('permission:report.read'), 'report.read', 'View permitted organization reports', CURRENT_TIMESTAMP),
  (md5('permission:report.export'), 'report.export', 'Export permitted organization reports', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Existing billing.run holders already possessed visit, mapping, synchronization and run authority.
-- Granting the split permissions preserves that authority without expanding any other role.
INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT md5(rp."roleDefinitionId" || ':' || p."id"), rp."roleDefinitionId", p."id", CURRENT_TIMESTAMP
FROM "RolePermission" rp
JOIN "Permission" legacy ON legacy."id" = rp."permissionId" AND legacy."code" = 'billing.run'
CROSS JOIN "Permission" p
WHERE p."code" IN ('billing.view', 'billing.initiate', 'billing.mapping.manage', 'billing.sync.manage')
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT md5(rp."roleDefinitionId" || ':' || p."id"), rp."roleDefinitionId", p."id", CURRENT_TIMESTAMP
FROM "RolePermission" rp
JOIN "Permission" legacy ON legacy."id" = rp."permissionId" AND legacy."code" = 'billing.view_billed'
CROSS JOIN "Permission" p
WHERE p."code" = 'billing.view'
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;

-- Owners receive the new administrative vocabulary; other roles remain least privilege.
INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT md5(r."id" || ':' || p."id"), r."id", p."id", CURRENT_TIMESTAMP
FROM "RoleDefinition" r CROSS JOIN "Permission" p
WHERE r."code" = 'ORGANIZATION_OWNER'
  AND ((r."isPlatformStandard" = TRUE AND r."organizationId" IS NULL) OR r."organizationId" IS NOT NULL)
  AND p."code" IN ('user.read','user.invite','user.manage','permission.manage','employee.self.read','client.assigned.read','client.caregiver.read','medication.assigned.read','medication.activity.record','billing.view','billing.initiate','billing.mapping.manage','billing.sync.manage','report.read','report.export')
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;

INSERT INTO "RoleDefinition" ("id", "organizationId", "code", "name", "description", "scope", "isPlatformStandard", "createdAt", "updatedAt") VALUES
  (md5('role:organization-admin'), NULL, 'ORGANIZATION_ADMIN', 'Organization Administrator', 'Delegated organization administration without owner safeguards.', 'PLATFORM', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (md5('role:billing-viewer'), NULL, 'BILLING_VIEWER', 'Billing Viewer', 'Read-only billing and EVV visibility.', 'PLATFORM', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (md5('role:billing-operator'), NULL, 'BILLING_OPERATOR', 'Billing Operator', 'Billing visibility plus supported initiation.', 'PLATFORM', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (md5('role:employee-caregiver'), NULL, 'EMPLOYEE_CAREGIVER', 'Employee / Caregiver', 'Employee self-service and assignment-scoped caregiver access.', 'PLATFORM', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT md5(r."id" || ':' || p."id"), r."id", p."id", CURRENT_TIMESTAMP
FROM "RoleDefinition" r JOIN "Permission" p ON
  (r."code" = 'BILLING_VIEWER' AND p."code" IN ('organization.read','billing.view')) OR
  (r."code" = 'BILLING_OPERATOR' AND p."code" IN ('organization.read','billing.view','billing.initiate')) OR
  (r."code" = 'EMPLOYEE_CAREGIVER' AND p."code" IN ('organization.read','employee.self.read','client.assigned.read','client.caregiver.read','medication.assigned.read')) OR
  (r."code" = 'ORGANIZATION_ADMIN' AND p."code" IN ('organization.read','organization.manage','user.read','user.invite','user.manage','permission.manage','employee.read','employee.manage','client.read','client.create','client.update','client.intake.manage','client.referral.manage','client.document.read','client.document.generate','client.signature.manage','billing.view','billing.mapping.manage','billing.sync.manage','report.read','report.export'))
WHERE r."organizationId" IS NULL AND r."isPlatformStandard" = TRUE
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT md5(r."id" || ':' || p."id"), r."id", p."id", CURRENT_TIMESTAMP
FROM "RoleDefinition" r CROSS JOIN "Permission" p
WHERE r."code" = 'DSP' AND p."code" IN ('employee.self.read','client.assigned.read','client.caregiver.read','medication.assigned.read')
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;
