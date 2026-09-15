import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createServiceAssignment } from "@/domain/service-assignments/service";
import { getComplianceIssue, listComplianceIssues, reconcileEmployeeIssues, reconcileOrganizationIssues, startIssueRemediation } from "@/domain/compliance-issues/service";

const db = new PrismaClient();

describe.sequential("Phase 11 compliance issue and remediation workflows", () => {
  const t0 = new Date("2026-01-01T12:00:00.000Z"), upcomingAt = new Date("2026-01-10T12:00:00.000Z"), overdueAt = new Date("2026-01-21T12:00:00.000Z");
  let organizationId: string, otherOrganizationId: string, ownerId: string, employeeId: string, complianceInstanceId: string, credentialId: string, activeAssignmentId: string;

  beforeAll(async () => {
    const tag = `phase11-${Date.now()}`, organization = await db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }), other = await db.organization.findFirstOrThrow({ where: { slug: "lakeside-community-services" } }), owner = await db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } });
    organizationId = organization.id; otherOrganizationId = other.id; ownerId = owner.id;
    const membership = await db.organizationMembership.create({ data: { organizationId, userId: owner.id, status: "ACTIVE" } }), role = await db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } });
    await db.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId: role.id } });
    const employee = await db.employee.create({ data: { organizationId, firstName: "Issue", lastName: "Worker", employmentStatus: "ACTIVE" } }); employeeId = employee.id;
    const ruleset = await db.complianceRuleset.findFirstOrThrow({ where: { status: "ACTIVE" } }), requirement = await db.complianceRequirement.create({ data: { code: `${tag}-TRAINING`, name: "Synthetic training requirement", licenseType: "MN_245D", requirementCategory: "WORKFORCE", versions: { create: { versionNumber: 1, effectiveFrom: t0, verificationStatus: "ORGANIZATION_POLICY", status: "ACTIVE", applicabilityDefinition: { test: true }, triggerDefinition: { type: "EMPLOYEE_HIRED" }, deadlineDefinition: { type: "NONE" } } } }, include: { versions: true } }).then(row => row.versions[0]);
    const instance = await db.complianceInstance.create({ data: { fingerprint: `${tag}:training`, organizationId, employeeId, requirementVersionId: requirement.id, triggerType: "EMPLOYEE_HIRED", requiredAt: t0, status: "ASSIGNED", lastEvaluatedAt: t0, rulesetId: ruleset.id } }); complianceInstanceId = instance.id;
    const credential = await db.professionalCredential.create({ data: { organizationId, employeeId, credentialType: "OTHER", credentialName: "Configured expiring credential", verificationStatus: "VERIFIED", verifiedAt: t0, expiresAt: new Date("2026-01-20T12:00:00.000Z"), status: "ACTIVE", evidenceReference: "configured-test-expiration" } }); credentialId = credential.id;
    const active = await createServiceAssignment({ id: owner.id }, organizationId, { employeeId, startsAt: new Date("2026-01-02T12:00:00.000Z"), blockingScope: "GENERAL_WORK", dutyDefinitionIds: [] }); activeAssignmentId = active.assignment.id;

    const createBlockedContext = async (recipient: string, reason: string) => {
      const assignment = await db.serviceAssignment.create({ data: { organizationId, employeeId, serviceRecipientRef: recipient, blockingScope: "MEDICATION_ADMINISTRATION", startsAt: t0, status: "BLOCKED", createdByUserId: owner.id } });
      const result = { eligible: false, reasonCodes: [reason], context: { serviceRecipientRef: recipient }, evidenceBasis: {} };
      await db.serviceAssignmentEligibilityEvaluation.create({ data: { organizationId, employeeId, assignmentId: assignment.id, actorUserId: owner.id, trigger: "CREATION", decision: "BLOCKED", evaluatedAt: t0, engineVersion: "phase10-v1", inputSnapshot: { serviceRecipientRef: recipient }, resultSnapshot: result } });
      return assignment;
    };
    await createBlockedContext(`${tag}-person-a`, "PERSON_SPECIFIC_INSTRUCTION_REQUIRED");
    await createBlockedContext(`${tag}-person-b`, "AUTHORIZATION_REQUIRED");
  });

  const owner = () => ({ id: ownerId });

  it("detects one idempotent actionable training issue without fabricating a deadline", async () => {
    await reconcileEmployeeIssues(owner(), organizationId, employeeId, t0); await reconcileEmployeeIssues(owner(), organizationId, employeeId, t0);
    const issues = await db.complianceIssue.findMany({ where: { organizationId, employeeId, issueType: "TRAINING_REQUIRED", status: { in: ["OPEN", "IN_PROGRESS"] } } });
    expect(issues).toHaveLength(1); expect(issues[0].dueAt).toBeNull();
    expect(await db.complianceIssueEvent.count({ where: { complianceIssueId: issues[0].id, action: "issue.detected" } })).toBe(1);
  });

  it("resolves only from underlying completion evidence and preserves issue history", async () => {
    const issue = await db.complianceIssue.findFirstOrThrow({ where: { organizationId, employeeId, issueType: "TRAINING_REQUIRED", status: "OPEN" } });
    await startIssueRemediation(owner(), organizationId, issue.id); expect((await getComplianceIssue(owner(), organizationId, issue.id)).status).toBe("IN_PROGRESS");
    const course = await db.trainingCourse.create({ data: { organizationId, catalogKey: `${organizationId}:resolution`, code: "RESOLUTION", title: "Resolution evidence", category: "TEST", ownershipType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "PUBLISHED", effectiveFrom: t0, publishedAt: t0, contentHash: "resolution-v1" } } }, include: { versions: true } }), version = course.versions[0];
    const assignment = await db.trainingAssignment.create({ data: { fingerprint: `${organizationId}:resolution`, organizationId, employeeId, courseVersionId: version.id, complianceInstanceId, sourceType: "COMPLIANCE_ENGINE", status: "COMPLETED", completedAt: t0 } });
    const completion = await db.trainingCompletion.create({ data: { organizationId, employeeId, assignmentId: assignment.id, courseId: course.id, courseVersionId: version.id, completedAt: t0, completionMethod: "COURSEWORK", evidenceSnapshotJson: { complianceInstanceId }, contentHash: version.contentHash } });
    await db.complianceInstanceEvidence.create({ data: { complianceInstanceId, evidenceType: "TRAINING_COMPLETION", evidenceReferenceId: completion.id } });
    await db.complianceInstance.update({ where: { id: complianceInstanceId }, data: { status: "SATISFIED", satisfiedAt: t0, lastEvaluatedAt: t0 } });
    await reconcileEmployeeIssues(owner(), organizationId, employeeId, t0);
    const historical = await getComplianceIssue(owner(), organizationId, issue.id); expect(historical.status).toBe("RESOLVED"); expect(historical.events.map(event => event.action)).toEqual(expect.arrayContaining(["issue.detected", "issue.remediation_started", "issue.resolved"]));
  });

  it("derives upcoming and overdue only from the configured credential expiration", async () => {
    await reconcileEmployeeIssues(owner(), organizationId, employeeId, upcomingAt);
    const upcoming = await listComplianceIssues(owner(), organizationId, { employeeId, issueType: "CREDENTIAL_EXPIRING", upcoming: true }, upcomingAt); expect(upcoming.issues).toHaveLength(1); expect(upcoming.issues[0].dueAt?.toISOString()).toBe("2026-01-20T00:00:00.000Z"); expect(upcoming.issues[0].deadlineState).toBe("UPCOMING");
    await reconcileEmployeeIssues(owner(), organizationId, employeeId, overdueAt);
    const overdue = await listComplianceIssues(owner(), organizationId, { employeeId, issueType: "CREDENTIAL_INVALID", overdue: true }, overdueAt); expect(overdue.issues).toHaveLength(1); expect(overdue.issues[0].sourceId).toBe(credentialId); expect(overdue.issues[0].deadlineState).toBe("OVERDUE");
  });

  it("keeps person-specific and medication authorization deficiencies distinct by person", async () => {
    await reconcileEmployeeIssues(owner(), organizationId, employeeId, t0);
    const person = await db.complianceIssue.findFirstOrThrow({ where: { organizationId, employeeId, issueType: "PERSON_SPECIFIC_INSTRUCTION_REQUIRED", status: { in: ["OPEN", "IN_PROGRESS"] } } }), authorization = await db.complianceIssue.findFirstOrThrow({ where: { organizationId, employeeId, issueType: "MEDICATION_AUTHORIZATION_MISSING", status: { in: ["OPEN", "IN_PROGRESS"] } } });
    expect((person.contextJson as { serviceRecipientRef: string }).serviceRecipientRef).not.toBe((authorization.contextJson as { serviceRecipientRef: string }).serviceRecipientRef);
    await startIssueRemediation(owner(), organizationId, authorization.id); expect((await db.complianceIssue.findUniqueOrThrow({ where: { id: authorization.id } })).status).toBe("IN_PROGRESS");
  });

  it("creates a critical issue when an active assignment becomes blocked without mutating its original decision", async () => {
    const original = await db.serviceAssignmentEligibilityEvaluation.findFirstOrThrow({ where: { assignmentId: activeAssignmentId, trigger: "CREATION" } });
    await db.employee.update({ where: { id: employeeId }, data: { employmentStatus: "LEAVE" } }); await reconcileEmployeeIssues(owner(), organizationId, employeeId, t0);
    const issue = await db.complianceIssue.findFirstOrThrow({ where: { serviceAssignmentId: activeAssignmentId, issueType: "ACTIVE_ASSIGNMENT_BECAME_BLOCKED", status: "OPEN" } }); expect(issue.priority).toBe("CRITICAL");
    expect((await db.serviceAssignment.findUniqueOrThrow({ where: { id: activeAssignmentId } })).status).toBe("BLOCKED");
    expect((await db.serviceAssignmentEligibilityEvaluation.findUniqueOrThrow({ where: { id: original.id } })).decision).toBe("ELIGIBLE");
    expect(await db.serviceAssignmentEligibilityEvaluation.count({ where: { assignmentId: activeAssignmentId } })).toBeGreaterThan(1);
    await db.employee.update({ where: { id: employeeId }, data: { employmentStatus: "ACTIVE" } });
  });

  it("enforces tenant isolation and RBAC for reads, reconciliation, and workflow changes", async () => {
    const issue = await db.complianceIssue.findFirstOrThrow({ where: { organizationId, employeeId } });
    await expect(getComplianceIssue(owner(), otherOrganizationId, issue.id)).rejects.toThrow(); await expect(reconcileEmployeeIssues(owner(), otherOrganizationId, employeeId, t0)).rejects.toThrow(); await expect(startIssueRemediation(owner(), otherOrganizationId, issue.id)).rejects.toThrow();
    const viewer = await db.user.findUniqueOrThrow({ where: { email: "jordan.viewer@example.test" } }); await expect(reconcileOrganizationIssues({ id: viewer.id }, organizationId, t0)).rejects.toThrow();
  });
});
