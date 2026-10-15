-- Billing access: 'billing.run' sees everything and may bill; 'billing.view_billed' sees billed amounts only.
INSERT INTO "Permission" ("id","code","description","createdAt") VALUES
 ('permission-billing-run','billing.run','View all AxisCare visit and billing data and run billing',CURRENT_TIMESTAMP),
 ('permission-billing-view-billed','billing.view_billed','View amounts billed for existing clients (cannot bill)',CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RoleDefinition" ("id","organizationId","code","name","description","scope","isPlatformStandard","createdAt","updatedAt")
SELECT 'role-platform-billing',NULL,'BILLING','Billing','Reviews AxisCare visits and runs billing',CAST('PLATFORM' AS "RoleScope"),true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "RoleDefinition" WHERE "organizationId" IS NULL AND "code"='BILLING');

-- Organization Owner and Billing: run + view billed.
INSERT INTO "RolePermission" ("id","roleDefinitionId","permissionId","createdAt")
SELECT 'rp-billing-' || md5(r."id" || p."id"), r."id", p."id", CURRENT_TIMESTAMP
FROM "RoleDefinition" r CROSS JOIN "Permission" p
WHERE r."code" IN ('ORGANIZATION_OWNER','BILLING') AND r."organizationId" IS NULL AND p."code" IN ('billing.run','billing.view_billed')
ON CONFLICT ("roleDefinitionId","permissionId") DO NOTHING;

-- Existing admin roles that could open Billing before keep read access to billed amounts only.
INSERT INTO "RolePermission" ("id","roleDefinitionId","permissionId","createdAt")
SELECT 'rp-billing-view-' || md5(rp."roleDefinitionId"), rp."roleDefinitionId", p."id", CURRENT_TIMESTAMP
FROM "RolePermission" rp JOIN "Permission" existing ON existing."id"=rp."permissionId" AND existing."code"='organization.manage'
JOIN "RoleDefinition" r ON r."id"=rp."roleDefinitionId" AND r."code"<>'ORGANIZATION_OWNER'
CROSS JOIN "Permission" p WHERE p."code"='billing.view_billed'
ON CONFLICT ("roleDefinitionId","permissionId") DO NOTHING;
