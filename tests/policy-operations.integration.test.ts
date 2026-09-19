import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthorizationError, ValidationError } from "@/domain/auth/errors";
import { reconcileEmployeeIssues } from "@/domain/compliance-issues/service";
import { getOrganizationSetup } from "@/domain/organization-setup/service";
import {
  acknowledgePolicy,
  archivePolicy,
  assignPolicy,
  bulkAssignPolicy,
  createPolicy,
  createPolicyVersion,
  getPolicyDetail,
  getPolicyOperationsSummary,
  listPolicyLibrary,
  publishPolicyVersion,
  updateDraftPolicyVersion,
} from "@/domain/policies/service";

const db = new PrismaClient();
let organization: { id: string };
let otherOrganization: { id: string };
let administrator: { id: string };
let employeeUser: { id: string };
let employee: { id: string };
let inactiveEmployee: { id: string };
let foreignEmployee: { id: string };
let policy: { id: string };
let versionOneId: string;
let assignmentId: string;
let reacknowledgmentAssignmentId: string;

beforeAll(async () => {
  const tag = `phase19-${Date.now()}`;
  [organization, otherOrganization] = await Promise.all([
    db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } }),
    db.organization.create({ data: { legalName: `${tag}-other`, displayName: `${tag}-other`, slug: `${tag}-other` } }),
  ]);
  [administrator, employeeUser] = await Promise.all([
    db.user.create({ data: { email: `admin-${tag}@example.test`, status: "ACTIVE" } }),
    db.user.create({ data: { email: `employee-${tag}@example.test`, status: "ACTIVE" } }),
  ]);
  [employee, inactiveEmployee, foreignEmployee] = await Promise.all([
    db.employee.create({ data: { organizationId: organization.id, userId: employeeUser.id, firstName: "Policy", lastName: "Employee", employmentStatus: "ACTIVE" } }),
    db.employee.create({ data: { organizationId: organization.id, firstName: "Inactive", lastName: "Employee", employmentStatus: "TERMINATED" } }),
    db.employee.create({ data: { organizationId: otherOrganization.id, firstName: "Foreign", lastName: "Employee", employmentStatus: "ACTIVE" } }),
  ]);
  const codes = ["policy.read", "policy.manage", "policy.assign", "compliance_issue.reconcile", "employee.read", "compliance.operations.read", "medication.read", "organization.manage"];
  for (const code of codes) await db.permission.upsert({ where: { code }, update: {}, create: { code } });
  const role = await db.roleDefinition.create({ data: { organizationId: organization.id, code: "POLICY_ADMIN", name: "Policy administrator", scope: "ORGANIZATION" } });
  const permissions = await db.permission.findMany({ where: { code: { in: codes } } });
  await db.rolePermission.createMany({ data: permissions.map(({ id }) => ({ roleDefinitionId: role.id, permissionId: id })) });
  const membership = await db.organizationMembership.create({ data: { organizationId: organization.id, userId: administrator.id, status: "ACTIVE" } });
  await db.membershipRole.create({ data: { membershipId: membership.id, roleDefinitionId: role.id } });
  await db.organizationMembership.create({ data: { organizationId: organization.id, userId: employeeUser.id, status: "ACTIVE" } });
});

describe("Phase 19 policy lifecycle and operations", () => {
  it("creates, corrects, and explicitly publishes a controlled policy version", async () => {
    policy = await createPolicy(administrator, organization.id, { code: "CLIENT-RIGHTS", title: "Client rights", requiresAcknowledgment: true, reacknowledgeOnNewVersion: true, blockingScope: "DIRECT_CONTACT" });
    const draft = await createPolicyVersion(administrator, organization.id, policy.id, { effectiveFrom: new Date("2026-09-01"), body: "Draft content" });
    const corrected = await updateDraftPolicyVersion(administrator, organization.id, draft.id, { body: "Published version one", reason: "Correct approved wording" });
    expect(corrected.status).toBe("DRAFT");
    versionOneId = (await publishPolicyVersion(administrator, organization.id, draft.id)).id;
    await expect(updateDraftPolicyVersion(administrator, organization.id, versionOneId, { body: "Mutated", reason: "Should fail" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("supports bounded library search, detail history, and honest operations metrics", async () => {
    const library = await listPolicyLibrary(administrator, organization.id, { search: "rights", pageSize: 1 });
    expect(library.total).toBe(1);
    expect(library.items[0].currentVersion?.id).toBe(versionOneId);
    expect(library.semantics.acknowledgmentPercentage).toContain("not legal compliance");
    expect((await getPolicyDetail(administrator, organization.id, policy.id)).versions).toHaveLength(1);
    expect((await getPolicyOperationsSummary(administrator, organization.id)).activePolicies).toBe(1);
    expect((await getOrganizationSetup(administrator, organization.id)).readiness.items.find((item) => item.key === "policies")?.state).toBe("COMPLETE");
    await expect(listPolicyLibrary(employeeUser, organization.id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getPolicyDetail(administrator, otherOrganization.id, policy.id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("prevents employees from publishing policy drafts and bounds bulk input", async () => {
    const draft = await createPolicyVersion(administrator, organization.id, policy.id, { effectiveFrom: new Date("2026-09-15"), body: "Unpublished draft" });
    await expect(publishPolicyVersion(employeeUser, organization.id, draft.id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(bulkAssignPolicy(administrator, organization.id, versionOneId, Array.from({ length: 501 }, () => employee.id))).rejects.toThrow();
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
  });

  it("assigns idempotently and permits only the employee to acknowledge the exact version", async () => {
    const assignment = await assignPolicy(administrator, organization.id, employee.id, versionOneId, "MANUAL", "phase19");
    assignmentId = assignment.id;
    expect((await assignPolicy(administrator, organization.id, employee.id, versionOneId, "MANUAL", "phase19")).id).toBe(assignment.id);
    await expect(acknowledgePolicy(administrator, organization.id, assignment.id, { typedName: "Administrator" })).rejects.toBeInstanceOf(AuthorizationError);
    const acknowledged = await acknowledgePolicy(employeeUser, organization.id, assignment.id, { typedName: "Policy Employee" });
    const attestation = await db.attestation.findUniqueOrThrow({ where: { id: acknowledged.attestationId! } });
    expect(attestation.resourceVersionId).toBe(versionOneId);
    expect(attestation.signerEmployeeId).toBe(employee.id);
  });

  it("preserves the prior acknowledgment and creates an exact-version re-acknowledgment", async () => {
    const next = await createPolicyVersion(administrator, organization.id, policy.id, { effectiveFrom: new Date("2026-10-01"), body: "Published version two" });
    const versionTwo = await publishPolicyVersion(administrator, organization.id, next.id);
    const oldAssignment = await db.policyAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    const newAssignments = await db.policyAssignment.findMany({ where: { organizationId: organization.id, employeeId: employee.id, policyVersionId: versionTwo.id } });
    expect(oldAssignment.status).toBe("ACKNOWLEDGED");
    expect(oldAssignment.attestationId).toBeTruthy();
    expect(newAssignments).toHaveLength(1);
    expect(newAssignments[0].status).toBe("PENDING");
    reacknowledgmentAssignmentId = newAssignments[0].id;
    expect((await db.policyVersion.findUniqueOrThrow({ where: { id: versionOneId } })).status).toBe("SUPERSEDED");
  });

  it("bulk distribution is idempotent, skips inactive workers, and rejects cross-tenant IDs", async () => {
    const current = await db.policyVersion.findFirstOrThrow({ where: { policyId: policy.id, status: "PUBLISHED" } });
    const first = await bulkAssignPolicy(administrator, organization.id, current.id, [employee.id, inactiveEmployee.id]);
    expect(first.find((row) => row.employeeId === employee.id)?.status).toBe("EXISTING");
    expect(first.find((row) => row.employeeId === inactiveEmployee.id)?.status).toBe("SKIPPED");
    await expect(bulkAssignPolicy(administrator, organization.id, current.id, [foreignEmployee.id])).rejects.toBeInstanceOf(ValidationError);
    await expect(assignPolicy(administrator, organization.id, inactiveEmployee.id, current.id, "MANUAL")).rejects.toBeInstanceOf(ValidationError);
    expect(await db.policyAssignment.count({ where: { employeeId: employee.id, policyVersionId: current.id } })).toBe(1);
  });

  it("reconciles the new exact-version requirement idempotently and resolves only after re-acknowledgment", async () => {
    await reconcileEmployeeIssues(administrator, organization.id, employee.id);
    await reconcileEmployeeIssues(administrator, organization.id, employee.id);
    const issue = await db.complianceIssue.findFirstOrThrow({ where: { organizationId: organization.id, employeeId: employee.id, sourceType: "PolicyAssignment", sourceId: reacknowledgmentAssignmentId } });
    expect(issue.status).toBe("OPEN");
    expect(await db.complianceIssueEvent.count({ where: { complianceIssueId: issue.id, action: "issue.detected" } })).toBe(1);
    await acknowledgePolicy(employeeUser, organization.id, reacknowledgmentAssignmentId, { typedName: "Policy Employee" });
    await reconcileEmployeeIssues(administrator, organization.id, employee.id);
    expect((await db.complianceIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("RESOLVED");
  });

  it("archives future operations without deleting controlled history", async () => {
    const archived = await archivePolicy(administrator, organization.id, policy.id, "Policy retired by organization");
    expect(archived.status).toBe("ARCHIVED");
    expect(await db.policyVersion.count({ where: { policyId: policy.id } })).toBe(3);
    expect(await db.attestation.count({ where: { resourceVersionId: versionOneId } })).toBe(1);
    expect(await db.attestation.count({ where: { resourceVersionId: { not: versionOneId }, resourceType: "POLICY_ASSIGNMENT", signerEmployeeId: employee.id } })).toBe(1);
  });

  it("preserves policy evidence across separation and does not fabricate assignments on reactivation", async () => {
    const before = await db.policyAssignment.count({ where: { employeeId: employee.id } });
    await db.employee.update({ where: { id: employee.id }, data: { employmentStatus: "TERMINATED", terminationDate: new Date("2026-11-01") } });
    expect(await db.attestation.count({ where: { signerEmployeeId: employee.id, resourceType: "POLICY_ASSIGNMENT" } })).toBe(2);
    await db.employee.update({ where: { id: employee.id }, data: { employmentStatus: "ACTIVE", terminationDate: null } });
    expect(await db.policyAssignment.count({ where: { employeeId: employee.id } })).toBe(before);
  });

  it("records creation, publication, assignment, acknowledgment, bulk, and archive audit events", async () => {
    const eventTypes = new Set((await db.auditEvent.findMany({ where: { organizationId: organization.id }, select: { eventType: true } })).map(({ eventType }) => eventType));
    for (const eventType of ["policy.created", "policy.version_created", "policy.version_published", "policy.version_superseded", "policy.reacknowledgment_required", "policy.assigned", "employee.policy_acknowledged", "policy.bulk_assigned", "policy.archived"]) expect(eventTypes.has(eventType)).toBe(true);
  });
});
