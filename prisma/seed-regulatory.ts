import { Prisma, type PrismaClient } from "@prisma/client";

type Database = PrismaClient | Prisma.TransactionClient;

const regulatorySources = [
  ["245D.09", "Staff qualifications and orientation", "https://www.revisor.mn.gov/statutes/cite/245D.09"],
  ["245D.095", "License holder requirements", "https://www.revisor.mn.gov/statutes/cite/245D.095"],
  ["245D.05", "Health services", "https://www.revisor.mn.gov/statutes/cite/245D.05"],
  ["245D.04", "Protection standards", "https://www.revisor.mn.gov/statutes/cite/245D.04"],
  ["245D.06", "Protection standards", "https://www.revisor.mn.gov/statutes/cite/245D.06"],
  ["245D.061", "Incident response", "https://www.revisor.mn.gov/statutes/cite/245D.061"],
  ["245D.07", "Service planning", "https://www.revisor.mn.gov/statutes/cite/245D.07"],
  ["245D.11", "Policies and procedures", "https://www.revisor.mn.gov/statutes/cite/245D.11"],
  ["245A.65", "Maltreatment reporting", "https://www.revisor.mn.gov/statutes/cite/245A.65"],
  ["626.557", "Vulnerable adults reporting", "https://www.revisor.mn.gov/statutes/cite/626.557"],
] as const;

const requirementNames = [
  "Staff Qualifications and Competency", "Job Description and Job-Function Orientation", "Incident Reporting", "Safety Practices",
  "License Holder Policies and Procedures", "Data Privacy and Confidentiality", "Service Recipient Rights", "Maltreatment and Mandated Reporting",
  "Person-Centered Service Planning and Delivery", "Emergency Manual Restraint and Restraint Awareness", "Prohibited Procedures", "Basic First Aid",
  "Healthy Relationships, Consent, Bodily Autonomy and Sexual Violence Risk Reduction", "Other Topics Required by Support Plan, Case Manager or License Holder",
  "Annual 245D Refresher Bundle", "External Prior Training Equivalency", "Periodic Performance Evaluation", "Temporary and Subcontract Staff Compliance",
  "Volunteer Direct-Support Training",
] as const;

const effectiveFrom = new Date("2026-08-01T00:00:00.000Z");
const executableRequirements = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19]);

/** Platform-owned, production-safe Minnesota 245D reference data. No tenant or employee evidence is created. */
export async function seedProductionRegulatoryRegistry(db: Database) {
  const authority = await db.regulatoryAuthority.upsert({
    where: { jurisdiction_agency_name: { jurisdiction: "Minnesota", agency: "Minnesota Legislature / Revisor", name: "Minnesota Revisor of Statutes" } },
    update: { sourceUrl: "https://www.revisor.mn.gov/statutes/" },
    create: { jurisdiction: "Minnesota", agency: "Minnesota Legislature / Revisor", name: "Minnesota Revisor of Statutes", sourceUrl: "https://www.revisor.mn.gov/statutes/" },
  });
  await db.regulatoryAuthority.upsert({
    where: { jurisdiction_agency_name: { jurisdiction: "Minnesota", agency: "Department of Human Services", name: "Minnesota Department of Human Services" } },
    update: { sourceUrl: "https://mn.gov/dhs/" },
    create: { jurisdiction: "Minnesota", agency: "Department of Human Services", name: "Minnesota Department of Human Services", sourceUrl: "https://mn.gov/dhs/" },
  });

  const versions = new Map<string, string>();
  for (const [citation, title, sourceUrl] of regulatorySources) {
    const regulation = await db.regulation.upsert({
      where: { authorityId_citation: { authorityId: authority.id, citation } }, update: { title }, create: { authorityId: authority.id, citation, title },
    });
    const version = await db.regulationVersion.upsert({
      where: { regulationId_effectiveFrom: { regulationId: regulation.id, effectiveFrom } },
      update: { sourceUrl, verificationStatus: "PRIMARY_SOURCE_VERIFIED", status: "ACTIVE" },
      create: { regulationId: regulation.id, effectiveFrom, sourceUrl, verificationStatus: "PRIMARY_SOURCE_VERIFIED", verifiedAt: effectiveFrom, status: "ACTIVE" },
    });
    versions.set(citation, version.id);
  }

  const ruleset = await db.complianceRuleset.upsert({
    where: { licenseType_version: { licenseType: "MN_245D", version: 1 } },
    update: {},
    create: { licenseType: "MN_245D", version: 1, effectiveFrom, status: "ACTIVE", approvedAt: effectiveFrom, contentHash: "frozen-phase-0-v1" },
  });

  for (let number = 1; number <= requirementNames.length; number += 1) {
    const code = `245D-WF-${String(number).padStart(3, "0")}`;
    const requirement = await db.complianceRequirement.upsert({
      where: { code }, update: { name: requirementNames[number - 1] },
      create: { code, name: requirementNames[number - 1], licenseType: "MN_245D", requirementCategory: "WORKFORCE" },
    });
    let version = await db.complianceRequirementVersion.findUnique({ where: { requirementId_versionNumber: { requirementId: requirement.id, versionNumber: 1 } } });
    if (!version) {
      let applicabilityDefinition: Prisma.InputJsonValue = { schemaVersion: 1, all: [{ type: "ORGANIZATION_LICENSE", licenseType: "MN_245D" }, { type: "EMPLOYEE_DUTY_ANY", duties: ["DIRECT_SUPPORT"] }] };
      let triggerDefinition: Prisma.InputJsonValue = { schemaVersion: 1, type: "EMPLOYEE_HIRED" };
      let deadlineDefinition: Prisma.InputJsonValue = { schemaVersion: 1, type: "WITHIN_CALENDAR_DAYS", days: 60 };
      const recurrenceDefinition: Prisma.InputJsonValue = { schemaVersion: 1, type: number >= 6 && number <= 13 ? "ANNUAL" : "NONE" };
      const legalGraceDefinition: Prisma.InputJsonValue = number >= 6 && number <= 13 ? { schemaVersion: 1, type: "CALENDAR_DAYS_AFTER_NOMINAL_DUE", days: 90, effectiveFrom: "2026-08-01", appliesTo: "ANNUAL_ONLY" } : { schemaVersion: 1, type: "NONE" };
      if ([1, 14, 15, 16, 17].includes(number)) { triggerDefinition = { schemaVersion: 1, type: "FIXED_REQUIREMENT" }; deadlineDefinition = { schemaVersion: 1, type: "NO_FIXED_DEADLINE" }; }
      if (number === 8) { triggerDefinition = { schemaVersion: 1, type: "FIRST_DIRECT_CONTACT" }; deadlineDefinition = { schemaVersion: 1, type: "WITHIN_HOURS", hours: 72 }; }
      if (number === 18) applicabilityDefinition = { schemaVersion: 1, all: [{ type: "ORGANIZATION_LICENSE", licenseType: "MN_245D" }, { type: "EMPLOYMENT_TYPE", employmentTypes: ["TEMPORARY", "CONTRACTOR"] }] };
      if (number === 19) applicabilityDefinition = { schemaVersion: 1, all: [{ type: "ORGANIZATION_LICENSE", licenseType: "MN_245D" }, { type: "EMPLOYMENT_TYPE", employmentTypes: ["VOLUNTEER"] }, { type: "EMPLOYEE_DUTY", duty: "DIRECT_SUPPORT" }] };
      version = await db.complianceRequirementVersion.create({ data: {
        requirementId: requirement.id, versionNumber: 1, effectiveFrom, verificationStatus: "PRIMARY_SOURCE_VERIFIED", status: "ACTIVE",
        applicabilityDefinition, triggerDefinition, deadlineDefinition, recurrenceDefinition, legalGraceDefinition,
        competencyDefinition: number === 10 ? { schemaVersion: 1, type: "REQUIRED", requirements: ["KNOWLEDGE_TEST", "OBSERVED_SKILL"] } : { schemaVersion: 1, type: "NONE" },
        evidenceDefinition: { schemaVersion: 1, required: ["TRAINING_COMPLETION"] }, blockingScope: number === 8 ? "DIRECT_CONTACT" : null,
      } });
    }
    const citation = number === 8 ? "245A.65" : "245D.09";
    await db.requirementAuthorityMapping.upsert({
      where: { requirementVersionId_regulationVersionId_relationshipType: { requirementVersionId: version.id, regulationVersionId: versions.get(citation)!, relationshipType: "PRIMARY" } },
      update: {},
      create: { requirementVersionId: version.id, regulationVersionId: versions.get(citation)!, relationshipType: "PRIMARY", citationNote: number === 8 ? "Minn. Stat. §245D.09 subd. 4(5), with applicable maltreatment statutes" : `Minn. Stat. §245D.09${number > 1 && number < 15 ? ` subd. 4(${Math.min(number - 1, 11)})` : ""}` },
    });
    if (executableRequirements.has(number)) await db.complianceRulesetRequirement.upsert({
      where: { rulesetId_requirementVersionId: { rulesetId: ruleset.id, requirementVersionId: version.id } }, update: {},
      create: { rulesetId: ruleset.id, requirementVersionId: version.id },
    });
  }
  return ruleset;
}
