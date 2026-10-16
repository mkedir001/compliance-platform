-- Organization-scoped owner roles are valid owner roles, but the original Billing
-- permission migration only granted Billing access to the platform-standard owner.
-- Backfill the same least-privilege Billing permissions for existing tenant owners.
INSERT INTO "RolePermission" ("id", "roleDefinitionId", "permissionId", "createdAt")
SELECT 'rp-billing-owner-' || md5(r."id" || p."id"), r."id", p."id", CURRENT_TIMESTAMP
FROM "RoleDefinition" r
CROSS JOIN "Permission" p
WHERE r."code" = 'ORGANIZATION_OWNER'
  AND r."organizationId" IS NOT NULL
  AND r."isPlatformStandard" = false
  AND p."code" IN ('billing.run', 'billing.view_billed')
ON CONFLICT ("roleDefinitionId", "permissionId") DO NOTHING;
