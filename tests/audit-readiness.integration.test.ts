import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { auditManifestDigest, createAuditPackage, getAuditPackage, getEmployeeAuditRecord, getRequirementEvidenceTrace, queryAuditEvents } from "@/domain/audit/service";

const db = new PrismaClient();

describe.sequential("Phase 12 audit readiness and evidence export", () => {
  const beforeCompletion = new Date("2026-10-01T00:00:00.000Z"), completionAt = new Date("2026-11-01T00:00:00.000Z"), afterCompletion = new Date("2026-12-01T00:00:00.000Z");
  let organizationId: string, otherOrganizationId: string, ownerId: string, viewerId: string, employeeId: string, requirementVersionId: string, completionId: string;

  beforeAll(async () => {
    const tag = `phase12-${Date.now()}`;
    const [owner, viewer, ownerRole, auditorRole, ruleset, regulationVersion] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } }),
      db.user.findUniqueOrThrow({ where: { email: "jordan.viewer@example.test" } }),
      db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } }),
      db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "AUDITOR" } }),
      db.complianceRuleset.findFirstOrThrow({ where: { status: "ACTIVE" } }),
      db.regulationVersion.findFirstOrThrow({ where: { status: "ACTIVE" }, include: { regulation: true } }),
    ]);
    ownerId = owner.id; viewerId = viewer.id;
    const organization = await db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }); organizationId = organization.id;
    otherOrganizationId = (await db.organization.findFirstOrThrow({ where: { slug: "lakeside-community-services" } })).id;
    for (const [userId, roleDefinitionId] of [[owner.id, ownerRole.id], [viewer.id, auditorRole.id]]) {
      const membership = await db.organizationMembership.create({ data: { organizationId, userId, status: "ACTIVE" } });
      await db.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId } });
    }
    const employee = await db.employee.create({ data: { organizationId, employeeNumber: "AUD-1", firstName: "Audit", lastName: "Worker", employmentStatus: "ACTIVE", hireDate: new Date("2026-01-01"), createdAt: new Date("2026-01-01") } }); employeeId = employee.id;
    const requirement = await db.complianceRequirement.create({ data: { code: `${tag}-REQ`, name: "Traceable audit requirement", licenseType: "MN_245D", requirementCategory: "WORKFORCE", versions: { create: { versionNumber: 1, effectiveFrom: new Date("2026-01-01"), verificationStatus: "PRIMARY_SOURCE_VERIFIED", status: "ACTIVE", applicabilityDefinition: { schemaVersion: 1 }, triggerDefinition: { schemaVersion: 1 }, deadlineDefinition: { schemaVersion: 1 } } } }, include: { versions: true } }); requirementVersionId = requirement.versions[0].id;
    await db.requirementAuthorityMapping.create({ data: { requirementVersionId, regulationVersionId: regulationVersion.id, relationshipType: "PRIMARY", citationNote: regulationVersion.regulation.citation } });
    const instance = await db.complianceInstance.create({ data: { fingerprint: `${tag}:instance`, organizationId, employeeId, requirementVersionId, triggerType: "EMPLOYEE_HIRED", requiredAt: new Date("2026-01-01"), nominalDueAt: beforeCompletion, status: "SATISFIED", satisfiedAt: completionAt, lastEvaluatedAt: completionAt, rulesetId: ruleset.id } });
    const course = await db.trainingCourse.create({ data: { organizationId, catalogKey: `${tag}:course`, code: "AUDIT-COURSE", title: "Audit course", category: "MEDICATION", ownershipType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "PUBLISHED", effectiveFrom: new Date("2026-01-01"), publishedAt: new Date("2026-01-01"), contentHash: "audit-course-v1" } } }, include: { versions: true } });
    await db.requirementTrainingOption.create({ data: { complianceRequirementVersionId: requirementVersionId, trainingCourseVersionId: course.versions[0].id, satisfactionType: "TRAINING_ONLY", isDefault: true } });
    const assignment = await db.trainingAssignment.create({ data: { fingerprint: `${tag}:assignment`, organizationId, employeeId, courseVersionId: course.versions[0].id, complianceInstanceId: instance.id, sourceType: "COMPLIANCE_ENGINE", assignedAt: new Date("2026-01-10"), status: "COMPLETED", completedAt: completionAt } });
    const completion = await db.trainingCompletion.create({ data: { organizationId, employeeId, assignmentId: assignment.id, courseId: course.id, courseVersionId: course.versions[0].id, completedAt: completionAt, completionMethod: "COURSEWORK", evidenceSnapshotJson: { source: "training" }, contentHash: "audit-course-v1" } }); completionId = completion.id;
    await db.complianceInstanceEvidence.create({ data: { complianceInstanceId: instance.id, evidenceType: "TRAINING_COMPLETION", evidenceReferenceId: completion.id, createdAt: completionAt } });
    await db.professionalCredential.create({ data: { organizationId, employeeId, credentialType: "OTHER", credentialName: "Historical credential", issuedAt: new Date("2026-01-01"), expiresAt: new Date("2026-10-15"), verificationStatus: "VERIFIED", status: "ACTIVE", evidenceReference: "credential-reference", createdAt: new Date("2026-01-01") } });
  });

  const owner = () => ({ id: ownerId });

  it("preserves regulatory/version provenance and links supporting evidence", async () => {
    const trace = await getRequirementEvidenceTrace(owner(), organizationId, requirementVersionId, employeeId);
    expect(trace.authority[0].regulationVersion.id).toBeTruthy(); expect(trace.authority[0].regulation.citation).toBeTruthy();
    expect(trace.evidence.some(item => item.referenceId === completionId)).toBe(true); expect(trace.evaluation.satisfied).toBe(true);
  });

  it("explicitly reports missing evidence without manufacturing satisfaction", async () => {
    const trace = await getRequirementEvidenceTrace(owner(), organizationId, requirementVersionId, employeeId, { mode: "POINT_IN_TIME", at: beforeCompletion });
    expect(trace.evaluation.satisfied).toBe(false); expect(trace.evidence).toHaveLength(0); expect(trace.deficiencies).toContainEqual(expect.objectContaining({ code: "REQUIRED_EVIDENCE_MISSING" }));
  });

  it("distinguishes current from point-in-time and excludes later completion evidence", async () => {
    const historical = await getEmployeeAuditRecord(owner(), organizationId, employeeId, { mode: "POINT_IN_TIME", at: beforeCompletion }), current = await getEmployeeAuditRecord(owner(), organizationId, employeeId);
    expect(historical.exportMetadata.view).toBe("POINT_IN_TIME"); expect(current.exportMetadata.view).toBe("CURRENT");
    expect(historical.training[0].completion).toBeNull(); expect(current.training[0].completion?.id).toBe(completionId);
    expect(historical.credentials[0].validityAtRequestedTime).toBe(true);
    const expired = await getEmployeeAuditRecord(owner(), organizationId, employeeId, { mode: "POINT_IN_TIME", at: afterCompletion }); expect(expired.credentials[0].validityAtRequestedTime).toBe(false);
  });

  it("keeps medication governance evidence types separate and never equates training with authorization", async () => {
    const record = await getEmployeeAuditRecord(owner(), organizationId, employeeId);
    expect(record.medicationGovernance.training).toHaveLength(1); expect(record.medicationGovernance.administrationAuthorization).toHaveLength(0);
    expect(record.medicationGovernance).toHaveProperty("knowledge"); expect(record.medicationGovernance).toHaveProperty("observedSkill"); expect(record.medicationGovernance).toHaveProperty("clinicalSignOffs"); expect(record.medicationGovernance).toHaveProperty("personSpecificInstruction");
  });

  it("produces deterministic change-sensitive SHA-256 digests", () => {
    const a = { z: 1, nested: { b: 2, a: 1 } }, same = { nested: { a: 1, b: 2 }, z: 1 };
    expect(auditManifestDigest(a)).toBe(auditManifestDigest(same)); expect(auditManifestDigest(a)).not.toBe(auditManifestDigest({ ...a, z: 2 })); expect(auditManifestDigest(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stores immutable package snapshots without changing compliance evidence", async () => {
    const countBefore = await db.complianceInstanceEvidence.count({ where: { complianceInstance: { organizationId } } });
    const first = await createAuditPackage(owner(), organizationId, { scope: "EMPLOYEE_COMPLIANCE_RECORD", subjectId: employeeId }), second = await createAuditPackage(owner(), organizationId, { scope: "EMPLOYEE_COMPLIANCE_RECORD", subjectId: employeeId });
    expect(first.id).not.toBe(second.id); expect(first.integrityDigest).toBeTruthy(); expect((await getAuditPackage(owner(), organizationId, first.id, true)).manifestJson).toEqual(first.manifestJson);
    expect(await db.complianceInstanceEvidence.count({ where: { complianceInstance: { organizationId } } })).toBe(countBefore);
  });

  it("minimizes sensitive and person-specific data", async () => {
    const json = JSON.stringify(await getEmployeeAuditRecord(owner(), organizationId, employeeId));
    expect(json).not.toContain("password"); expect(json).not.toContain("sessionReference"); expect(json).not.toContain("ipAddress"); expect(json).not.toContain("userAgent");
  });

  it("enforces tenant isolation and separate export permission", async () => {
    await expect(getEmployeeAuditRecord(owner(), otherOrganizationId, employeeId)).rejects.toThrow();
    await expect(createAuditPackage({ id: viewerId }, organizationId, { scope: "EMPLOYEE_COMPLIANCE_RECORD", subjectId: employeeId })).rejects.toThrow(/audit.export/);
    const pkg = await createAuditPackage(owner(), organizationId, { scope: "EMPLOYEE_COMPLIANCE_RECORD", subjectId: employeeId }); await expect(getAuditPackage(owner(), otherOrganizationId, pkg.id, true)).rejects.toThrow();
  });

  it("provides bounded filterable audit events", async () => {
    const events = await queryAuditEvents(owner(), organizationId, { employeeId, eventType: "audit.package_generated", limit: 500 }); expect(events.length).toBeGreaterThan(0); expect(events.length).toBeLessThanOrEqual(100); expect(events.every(event => event.employeeId === employeeId)).toBe(true);
  });
});
