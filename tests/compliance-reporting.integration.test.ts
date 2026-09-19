import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthorizationError } from "@/domain/auth/errors";
import { auditManifestDigest, createAuditPackage, getAuditPackage, getRequirementEvidenceTrace, verifyAuditPackageIntegrity } from "@/domain/audit/service";
import { getEmployeeComplianceReport, getEvidenceReport, getOrganizationComplianceReport, getPolicyReport, getRemediationReport, getServiceAssignmentReadinessReport, getTrainingReport, listAuditPackages, MAX_CSV_ROWS, rowsToCsv } from "@/domain/reporting/service";

const db = new PrismaClient();

describe.sequential("Phase 22 compliance reporting and regulator-ready exports", () => {
  let organizationId: string, otherOrganizationId: string, adminId: string, clinicalId: string, readerId: string, employeeId: string, historicalEmployeeId: string, requirementVersionId: string, noDueAssignmentId: string, policyVersionOneId: string;
  const now = new Date("2026-09-19T12:00:00.000Z");

  beforeAll(async () => {
    const tag = `phase22-${Date.now()}`;
    const [organization, otherOrganization, admin, clinical, reader] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
      db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } }),
      db.user.create({ data: { email: `report-admin-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `report-clinical-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `report-reader-${tag}@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id; otherOrganizationId = otherOrganization.id; adminId = admin.id; clinicalId = clinical.id; readerId = reader.id;
    const permissions = await db.permission.findMany({ where: { code: { in: ["audit.read", "audit.export", "employee.read", "clinical.review"] } } });
    for (const setup of [{ userId: adminId, code: "REPORT_ADMIN", codes: ["audit.read", "audit.export", "employee.read"] }, { userId: clinicalId, code: "REPORT_CLINICAL", codes: ["audit.read", "audit.export", "employee.read", "clinical.review"] }, { userId: readerId, code: "REPORT_READER", codes: ["audit.read", "employee.read"] }]) {
      const role = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-${setup.code}`, name: setup.code, scope: "ORGANIZATION" } });
      await db.rolePermission.createMany({ data: permissions.filter(item => setup.codes.includes(item.code)).map(item => ({ roleDefinitionId: role.id, permissionId: item.id })) });
      const membership = await db.organizationMembership.create({ data: { organizationId, userId: setup.userId, status: "ACTIVE" } });
      await db.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId: role.id } });
    }
    const [employee, historical] = await Promise.all([
      db.employee.create({ data: { organizationId, employeeNumber: "RPT-1", firstName: "Report", lastName: "Worker", employmentStatus: "ACTIVE", hireDate: new Date("2026-01-01") } }),
      db.employee.create({ data: { organizationId, employeeNumber: "RPT-2", firstName: "Historical", lastName: "Worker", employmentStatus: "TERMINATED", hireDate: new Date("2025-01-01"), terminationDate: new Date("2026-06-01") } }),
    ]);
    employeeId = employee.id; historicalEmployeeId = historical.id;
    const regulationVersion = await db.regulationVersion.findFirstOrThrow({ where: { status: "ACTIVE" } }), ruleset = await db.complianceRuleset.findFirstOrThrow({ where: { status: "ACTIVE" } });
    const requirement = await db.complianceRequirement.create({ data: { code: `${tag}-REQ`, name: "Report traceability requirement", licenseType: "MN_245D", requirementCategory: "WORKFORCE", versions: { create: { versionNumber: 1, status: "ACTIVE", effectiveFrom: new Date("2026-01-01"), verificationStatus: "PRIMARY_SOURCE_VERIFIED", applicabilityDefinition: {}, triggerDefinition: {}, deadlineDefinition: {} } } }, include: { versions: true } });
    requirementVersionId = requirement.versions[0].id;
    await db.requirementAuthorityMapping.create({ data: { requirementVersionId, regulationVersionId: regulationVersion.id, relationshipType: "PRIMARY" } });
    await db.complianceInstance.create({ data: { fingerprint: `${tag}:instance`, organizationId, employeeId, requirementVersionId, rulesetId: ruleset.id, triggerType: "EMPLOYEE_HIRED", requiredAt: new Date("2026-01-01"), status: "REQUIRED", lastEvaluatedAt: now } });
    const course = await db.trainingCourse.create({ data: { organizationId, catalogKey: `${tag}:course`, code: `${tag}-COURSE`, title: "Reporting course", category: "ORIENTATION", ownershipType: "ORGANIZATION", versions: { create: [{ versionNumber: 1, status: "RETIRED", effectiveFrom: new Date("2026-01-01"), publishedAt: new Date("2026-01-01"), contentHash: `${tag}-course-v1` }, { versionNumber: 2, status: "PUBLISHED", effectiveFrom: new Date("2026-05-01"), publishedAt: new Date("2026-05-01"), contentHash: `${tag}-course-v2` }] } }, include: { versions: true } });
    const [completed, noDue] = await Promise.all([
      db.trainingAssignment.create({ data: { fingerprint: `${tag}:completed`, organizationId, employeeId: historicalEmployeeId, courseVersionId: course.versions[0].id, sourceType: "MANUAL", status: "COMPLETED", assignedAt: new Date("2026-02-01"), completedAt: new Date("2026-03-01") } }),
      db.trainingAssignment.create({ data: { fingerprint: `${tag}:no-due`, activeKey: `${tag}:no-due`, organizationId, employeeId, courseVersionId: course.versions[1].id, sourceType: "MANUAL", status: "NOT_STARTED", assignedAt: new Date("2026-09-01") } }),
    ]);
    noDueAssignmentId = noDue.id;
    await db.trainingCompletion.create({ data: { organizationId, employeeId: historicalEmployeeId, assignmentId: completed.id, courseId: course.id, courseVersionId: course.versions[0].id, completedAt: new Date("2026-03-01"), completionMethod: "COURSEWORK", evidenceSnapshotJson: { bounded: true }, contentHash: `${tag}-course-v1` } });
    const policy = await db.policy.create({ data: { organizationId, code: `${tag}-POL`, title: "Reporting policy", requiresAcknowledgment: true, reacknowledgeOnNewVersion: true, versions: { create: [{ versionNumber: 1, status: "SUPERSEDED", effectiveFrom: new Date("2026-01-01"), body: "v1", contentHash: `${tag}-policy-v1`, createdByUserId: adminId }, { versionNumber: 2, status: "PUBLISHED", effectiveFrom: new Date("2026-07-01"), body: "v2", contentHash: `${tag}-policy-v2`, createdByUserId: adminId }] } }, include: { versions: true } });
    policyVersionOneId = policy.versions[0].id;
    await Promise.all([
      db.policyAssignment.create({ data: { fingerprint: `${tag}:policy-v1`, organizationId, employeeId, policyVersionId: policy.versions[0].id, sourceType: "MANUAL", status: "ACKNOWLEDGED", acknowledgedAt: new Date("2026-04-01") } }),
      db.policyAssignment.create({ data: { fingerprint: `${tag}:policy-v2`, organizationId, employeeId, policyVersionId: policy.versions[1].id, sourceType: "MANUAL", status: "PENDING" } }),
      db.professionalCredential.create({ data: { organizationId, employeeId, credentialType: "OTHER", credentialName: "Verified evidence", verificationStatus: "VERIFIED", status: "ACTIVE", expiresAt: new Date("2026-10-01") } }),
      db.professionalCredential.create({ data: { organizationId, employeeId, credentialType: "OTHER", credentialName: "Pending renewal", verificationStatus: "UNVERIFIED", status: "ACTIVE" } }),
    ]);
    const definition = await db.competencyDefinition.create({ data: { organizationId, ownerType: "ORGANIZATION", code: `${tag}-COMP`, name: "Observed reporting competency", method: "OBSERVED_SKILL" } });
    await db.competencyAssessment.create({ data: { organizationId, employeeId, competencyDefinitionId: definition.id, assessorUserId: clinicalId, assessorNameSnapshot: "Clinical Reviewer", status: "FINALIZED", result: "PASS", finalizedAt: new Date("2026-08-01") } });
    const original = await db.externalTrainingRecord.create({ data: { organizationId, employeeId, providerName: "Outside", trainingName: "External evidence", trainingDate: new Date("2026-02-01"), reviewStatus: "DENIED" } });
    await db.evidenceCorrection.create({ data: { organizationId, resourceType: "ExternalTrainingRecord", resourceId: original.id, correctionType: "CORRECTED_BY_REPLACEMENT", reason: "Corrected evidence supplied", replacementResourceType: "ExternalTrainingRecord", replacementResourceId: original.id, correctedByUserId: adminId } });
    const issueBase = { organizationId, employeeId, priority: "HIGH" as const, sourceType: "report", contextJson: {}, reasonCodesJson: [], remediationActionsJson: [], evidenceReferencesJson: [], firstDetectedAt: new Date("2026-08-01"), latestDetectedAt: now };
    await Promise.all([
      db.complianceIssue.create({ data: { ...issueBase, fingerprint: `${tag}:open`, activeKey: `${tag}:open`, issueType: "CREDENTIAL_INVALID", status: "OPEN", sourceId: `${tag}:open` } }),
      db.complianceIssue.create({ data: { ...issueBase, fingerprint: `${tag}:resolved`, issueType: "TRAINING_REQUIRED", status: "RESOLVED", sourceId: `${tag}:resolved`, resolvedAt: new Date("2026-09-01"), resolutionReason: "Evidence completed" } }),
    ]);
    const assignment = await db.serviceAssignment.create({ data: { organizationId, employeeId, blockingScope: "MEDICATION_ADMINISTRATION", status: "BLOCKED", startsAt: now, createdByUserId: adminId } });
    await db.serviceAssignmentEligibilityEvaluation.create({ data: { organizationId, employeeId, assignmentId: assignment.id, actorUserId: adminId, trigger: "CREATION", decision: "BLOCKED", evaluatedAt: now, engineVersion: "phase10-v1", inputSnapshot: {}, resultSnapshot: { reasonCodes: ["CLINICAL_SIGNOFF_REQUIRED"] } } });
    await Promise.all([
      db.notification.create({ data: { fingerprint: `${tag}:admin-note`, organizationId, recipientUserId: adminId, audience: "ADMINISTRATOR", notificationType: "COMPLIANCE_REMEDIATION_REQUIRED", sourceType: "ComplianceIssue", sourceId: `${tag}:open`, title: "Action", message: "Review record" } }),
      db.notification.create({ data: { fingerprint: `${tag}:clinical-note`, organizationId, recipientUserId: clinicalId, audience: "CLINICAL", notificationType: "CLINICAL_REMEDIATION_REQUIRED", sourceType: "ComplianceIssue", sourceId: `${tag}:open`, title: "Clinical action", message: "Privileged clinical detail" } }),
    ]);
  });

  const admin = () => ({ id: adminId });

  it("reports a precisely defined organization workforce state without a generic score", async () => {
    const report = await getOrganizationComplianceReport(admin(), organizationId, { at: now });
    expect(report.totalApplicableWorkforce).toBe(1); expect(report.employeesRequiringAction).toBe(1); expect(report).not.toHaveProperty("complianceScore"); expect(report.measurementDefinition).toContain("applicable non-superseded compliance instance");
  });

  it("preserves employee history and conservative point-in-time semantics", async () => {
    const historical = await getEmployeeComplianceReport(admin(), organizationId, historicalEmployeeId, new Date("2026-10-01"));
    expect(historical.employee.employmentStatus).toBe("TERMINATED"); expect(historical.employee.historicalLimitation).toBeTruthy(); expect(historical.training[0].completion).toBeTruthy(); expect(historical.historicalMeaning).toContain("not presented as exact historical reconstruction");
  });

  it("reports training status from real dates and keeps historical versions", async () => {
    const report = await getTrainingReport(admin(), organizationId, { pageSize: 100, at: now });
    const noDue = report.items.find(item => item.id === noDueAssignmentId); expect(noDue?.deadlineState).toBe("NO_DEADLINE"); expect(noDue?.dueAt).toBeNull(); expect(new Set(report.items.map(item => item.courseVersion))).toEqual(new Set([1, 2]));
  });

  it("ties policy acknowledgments to exact versions and does not imply re-acknowledgment", async () => {
    const report = await getPolicyReport(admin(), organizationId, { employeeId, pageSize: 100 });
    expect(report.items.find(item => item.policyVersionId === policyVersionOneId)?.status).toBe("ACKNOWLEDGED"); expect(report.items.find(item => item.versionNumber === 2)?.status).toBe("PENDING");
  });

  it("distinguishes verification, competency, equivalency, and correction history", async () => {
    const report = await getEvidenceReport(admin(), organizationId, { employeeId, pageSize: 100 });
    expect(new Set(report.credentials.map(item => item.verificationStatus))).toEqual(new Set(["VERIFIED", "UNVERIFIED"])); expect(report.competency.some(item => item.status === "FINALIZED" && item.result === "PASS")).toBe(true); expect(report.externalTraining[0].reviewStatus).toBe("DENIED"); expect(report.corrections).toHaveLength(1);
  });

  it("reports current and historical remediation without duplicate reconciliation counts", async () => {
    const all = await getRemediationReport(admin(), organizationId, { employeeId, pageSize: 100 }), open = await getRemediationReport(admin(), organizationId, { employeeId, status: "OPEN" });
    expect(all.items).toHaveLength(2); expect(open.items).toHaveLength(1); expect(all.items.find(item => item.status === "RESOLVED")?.resolutionReason).toBe("Evidence completed");
  });

  it("uses assignment guardrail results and enforces clinical detail boundaries", async () => {
    const ordinary = await getServiceAssignmentReadinessReport(admin(), organizationId, { employeeId }), privileged = await getServiceAssignmentReadinessReport({ id: clinicalId }, organizationId, { employeeId });
    expect(ordinary.items[0].readiness).toBe("BLOCKED"); expect(ordinary.items[0].reasonCodes).toEqual(["CLINICAL_DETAIL_REDACTED"]); expect(privileged.items[0].reasonCodes).toContain("CLINICAL_SIGNOFF_REQUIRED");
    expect((await getEmployeeComplianceReport(admin(), organizationId, employeeId)).medicationGovernance).toEqual(expect.objectContaining({ access: "REDACTED" }));
  });

  it("preserves regulatory traceability without manufacturing satisfaction", async () => {
    const trace = await getRequirementEvidenceTrace(admin(), organizationId, requirementVersionId, employeeId);
    expect(trace.authority).toHaveLength(1); expect(trace.evaluation.satisfied).toBe(false); expect(trace.deficiencies[0].code).toBe("REQUIRED_EVIDENCE_MISSING");
  });

  it("generates scoped immutable snapshots and deterministic integrity metadata", async () => {
    const generated = await createAuditPackage(admin(), organizationId, { scope: "ORGANIZATION_COMPLIANCE_SUMMARY", includedDomains: ["WORKFORCE", "TRAINING", "NOTIFICATIONS"], rangeFrom: new Date("2026-01-01"), rangeTo: now });
    const before = await getAuditPackage(admin(), organizationId, generated.id, true), manifest = before.manifestJson as { includedDomains: string[]; record: { records: { notifications: { audience: string }[] } } };
    expect(manifest.includedDomains).toEqual(["WORKFORCE", "TRAINING", "NOTIFICATIONS"]); expect(manifest.record.records.notifications.every(item => item.audience !== "CLINICAL")).toBe(true); expect((await verifyAuditPackageIntegrity(admin(), organizationId, generated.id)).verified).toBe(true);
    await db.trainingAssignment.update({ where: { id: noDueAssignmentId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    expect((await getAuditPackage(admin(), organizationId, generated.id, true)).manifestJson).toEqual(before.manifestJson);
    expect(auditManifestDigest(before.manifestJson)).toBe(before.integrityDigest);
  });

  it("provides bounded package listing and CSV output with spreadsheet-injection protection", async () => {
    const packages = await listAuditPackages(admin(), organizationId, { pageSize: 500 }); expect(packages.pageSize).toBe(100); expect(packages.items.length).toBeGreaterThan(0); expect(MAX_CSV_ROWS).toBe(1000);
    const csv = rowsToCsv([{ employee: "=HYPERLINK(\"bad\")", status: "CURRENT" }]); expect(csv).toContain("'=HYPERLINK");
  });

  it("enforces package/report authorization, tenant isolation, and cross-tenant probing", async () => {
    await expect(createAuditPackage({ id: readerId }, organizationId, { scope: "ORGANIZATION_COMPLIANCE_SUMMARY" })).rejects.toThrow(/audit.export/);
    await expect(getEmployeeComplianceReport(admin(), otherOrganizationId, employeeId)).rejects.toThrow();
    const generated = await createAuditPackage(admin(), organizationId, { scope: "EMPLOYEE_COMPLIANCE_RECORD", subjectId: employeeId });
    await expect(getAuditPackage(admin(), otherOrganizationId, generated.id, true)).rejects.toThrow();
  });

  it("rejects oversized audit-history packages and records reporting audit events", async () => {
    await db.auditEvent.createMany({ data: Array.from({ length: 2001 }, (_, index) => ({ organizationId, actorUserId: adminId, eventType: "phase22.bound_test", entityType: "Bound", entityId: String(index), occurredAt: new Date(now.getTime() + index) })) });
    await expect(createAuditPackage(admin(), organizationId, { scope: "ORGANIZATION_COMPLIANCE_SUMMARY", includedDomains: ["AUDIT_HISTORY"] })).rejects.toThrow(/exceeds 2000/);
    expect(await db.auditEvent.count({ where: { organizationId, eventType: { in: ["audit.package_requested", "audit.package_generated", "audit.package_accessed", "audit.package_failed"] } } })).toBeGreaterThan(0);
  });

  it("detects persisted package alteration before download", async () => {
    const generated = await createAuditPackage(admin(), organizationId, { scope: "EMPLOYEE_COMPLIANCE_RECORD", subjectId: employeeId });
    await db.auditPackage.update({ where: { id: generated.id }, data: { manifestJson: { altered: true } } });
    await expect(getAuditPackage(admin(), organizationId, generated.id, true)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
