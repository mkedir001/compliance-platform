-- Add approved, organization-scoped Radiant Care template versions without changing
-- platform defaults or historical document/template associations.
INSERT INTO "ClientDocumentTemplate"
  ("id", "organizationId", "code", "name", "documentType", "versionNumber", "status", "contentJson", "effectiveFrom", "createdAt")
SELECT
  'rc-intake-v2-' || substr(md5(o."id"), 1, 20), o."id", '00-INTAKE-CHECKLIST',
  'Radiant Care LLC - Intake Checklist', 'INTAKE_CHECKLIST', 2, 'ACTIVE',
  '{"renderer":"RADIANT_CARE_ACROFORM_V1","asset":"00_Intake_Checklist_Staff_Use.pdf","sourceSha256":"fdaff2002c1aa0f4cdde18863c8aca42569c2e43d4664313ddc8a39fa491b417","signerRoles":["ORGANIZATION_STAFF","DESIGNATED_COORDINATOR_OR_MANAGER"],"referencedFormsNotCreated":["03","05","06","07","08"]}'::jsonb,
  CURRENT_DATE, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE lower(trim(o."legalName")) IN ('radiant care', 'radiant care llc')
   OR lower(trim(o."displayName")) IN ('radiant care', 'radiant care llc')
ON CONFLICT ("organizationId", "code", "versionNumber") DO NOTHING;

INSERT INTO "ClientDocumentTemplate"
  ("id", "organizationId", "code", "name", "documentType", "versionNumber", "status", "contentJson", "effectiveFrom", "createdAt")
SELECT
  'rc-face-v2-' || substr(md5(o."id"), 1, 20), o."id", '01-FACE-SHEET',
  'Radiant Care LLC - Client Information / Face Sheet', 'FACE_SHEET', 2, 'ACTIVE',
  '{"renderer":"RADIANT_CARE_ACROFORM_V1","asset":"01_Client_Information_Face_Sheet.pdf","sourceSha256":"112a2dc8a3602b84ff43fdd494c887e0b134f6e70ea9af9a1bee4a78a941bfb9","signerRoles":["CLIENT_OR_LEGAL_REPRESENTATIVE","RADIANT_CARE_STAFF"]}'::jsonb,
  CURRENT_DATE, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE lower(trim(o."legalName")) IN ('radiant care', 'radiant care llc')
   OR lower(trim(o."displayName")) IN ('radiant care', 'radiant care llc')
ON CONFLICT ("organizationId", "code", "versionNumber") DO NOTHING;

INSERT INTO "ClientDocumentTemplate"
  ("id", "organizationId", "code", "name", "documentType", "versionNumber", "status", "contentJson", "effectiveFrom", "createdAt")
SELECT
  'rc-rights-v2-' || substr(md5(o."id"), 1, 20), o."id", '02-RIGHTS',
  'Radiant Care LLC - Service Recipient Rights', 'RIGHTS_ACKNOWLEDGMENT', 2, 'ACTIVE',
  '{"renderer":"RADIANT_CARE_ACROFORM_V1","asset":"02_Service_Recipient_Rights_Acknowledgment.pdf","sourceSha256":"071b3729eec8d667a439d1566824508f6f80b959bc20a103beea01d67f8a702a","authority":"Minn. Stat. 245D.04","signerRoles":["CLIENT","LEGAL_REPRESENTATIVE_IF_APPLICABLE","RADIANT_CARE_STAFF"]}'::jsonb,
  CURRENT_DATE, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE lower(trim(o."legalName")) IN ('radiant care', 'radiant care llc')
   OR lower(trim(o."displayName")) IN ('radiant care', 'radiant care llc')
ON CONFLICT ("organizationId", "code", "versionNumber") DO NOTHING;

INSERT INTO "ClientDocumentTemplate"
  ("id", "organizationId", "code", "name", "documentType", "versionNumber", "status", "contentJson", "effectiveFrom", "createdAt")
SELECT
  'rc-roi-v2-' || substr(md5(o."id"), 1, 20), o."id", '04-ROI',
  'Radiant Care LLC - Authorization to Release Information', 'ROI', 2, 'ACTIVE',
  '{"renderer":"RADIANT_CARE_ACROFORM_V1","asset":"04_Authorization_to_Release_Information.pdf","sourceSha256":"a980ac17b31af30e75432188b10d860cce7d6ce06faa0fbee41d327176f298c5","oneAuthorizationPerRecipient":true,"maximumDurationYears":1,"signerRoles":["CLIENT","LEGAL_REPRESENTATIVE_IF_APPLICABLE","RADIANT_CARE_STAFF"]}'::jsonb,
  CURRENT_DATE, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE lower(trim(o."legalName")) IN ('radiant care', 'radiant care llc')
   OR lower(trim(o."displayName")) IN ('radiant care', 'radiant care llc')
ON CONFLICT ("organizationId", "code", "versionNumber") DO NOTHING;
