import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getEmployerDashboard, getEmployerEmployeeDetail, getWorkforceDirectory } from "@/domain/admin/service";
import { approveClinicalCurriculum } from "@/domain/medication/service";
import { acknowledgePolicy, assignPolicy, createPolicy, createPolicyVersion, publishPolicyVersion } from "@/domain/policies/service";
import { claimEmployeePortalInvitation, getEmployeePortal, inviteEmployeeToPortal } from "@/domain/portal/service";
import { createManualAssignment } from "@/domain/training/assignments/service";
import { completeContent } from "@/domain/training/progress/service";

const db = new PrismaClient();

describe.sequential("Phase 14 employer operations portal", () => {
  let organizationId: string, otherOrganizationId: string, ownerId: string, viewerId: string;
  let employeeId: string, employeeUserId: string, courseVersionId: string, contentId: string, assignmentId: string, policyAssignmentId: string;

  beforeAll(async () => {
    const tag = `phase14-${Date.now()}`;
    const [owner, viewer, ownerRole, auditorRole, other] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: "alex.owner@example.test" } }),
      db.user.findUniqueOrThrow({ where: { email: "jordan.viewer@example.test" } }),
      db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "ORGANIZATION_OWNER" } }),
      db.roleDefinition.findFirstOrThrow({ where: { organizationId: null, code: "AUDITOR" } }),
      db.organization.findFirstOrThrow({ where: { slug: "lakeside-community-services" } }),
    ]);
    ownerId = owner.id; viewerId = viewer.id; otherOrganizationId = other.id;
    const organization = await db.organization.create({ data: { legalName: tag, displayName: tag, slug: tag } });
    organizationId = organization.id;
    const ownerMembership = await db.organizationMembership.create({ data: { organizationId, userId: ownerId, status: "ACTIVE" } });
    const viewerMembership = await db.organizationMembership.create({ data: { organizationId, userId: viewerId, status: "ACTIVE" } });
    await db.membershipRole.createMany({ data: [{ membershipId: ownerMembership.id, roleDefinitionId: ownerRole.id }, { membershipId: viewerMembership.id, roleDefinitionId: auditorRole.id }] });

    const employeeUser = await db.user.create({ data: { email: `${tag}@example.test`, status: "INVITED" } });
    employeeUserId = employeeUser.id;
    const employee = await db.employee.create({ data: { organizationId, email: employeeUser.email, employeeNumber: `P14-${Date.now()}`, firstName: "Employer", lastName: "Workflow", employmentStatus: "ACTIVE", hireDate: new Date("2026-09-01"), employmentType: "FULL_TIME" } });
    employeeId = employee.id;

    const course = await db.trainingCourse.create({
      data: { organizationId, catalogKey: `${tag}:course`, code: "P14-OPS", title: "Employer assigned operations training", category: "SAFETY", ownershipType: "ORGANIZATION", versions: { create: { versionNumber: 1, status: "PUBLISHED", effectiveFrom: new Date("2026-01-01"), publishedAt: new Date(), contentHash: `${tag}:v1`, modules: { create: { sequence: 1, title: "Operations lesson", moduleType: "CONTENT", contentItems: { create: { sequence: 1, contentType: "WRITTEN", payload: { heading: "Operations", body: "Required employer-assigned training content." }, required: true } } } } } } },
      include: { versions: { include: { modules: { include: { contentItems: true } } } } },
    });
    courseVersionId = course.versions[0].id;
    contentId = course.versions[0].modules[0].contentItems[0].id;
  });

  const owner = () => ({ id: ownerId });
  const employeeUser = () => ({ id: employeeUserId });

  it("supports the employer-to-employee invitation and training workflow", async () => {
    const invited = await inviteEmployeeToPortal(owner(), organizationId, employeeId);
    const user = await db.user.findUniqueOrThrow({ where: { id: employeeUserId } });
    await claimEmployeePortalInvitation(user, organizationId, invited.claimToken);
    const assignment = await createManualAssignment(owner(), organizationId, { employeeId, courseVersionId, dueAt: "2026-10-01T00:00:00.000Z" });
    assignmentId = assignment.id;
    expect((await getWorkforceDirectory(owner(), organizationId, { search: "Workflow" })).items[0].training.NOT_STARTED).toBe(1);
    await completeContent(assignment.id, employeeId, contentId);
    expect((await getEmployeePortal(employeeUser(), organizationId)).training[0].status).toBe("COMPLETED");
    expect((await getWorkforceDirectory(owner(), organizationId, { search: "P14-" })).items[0].training.COMPLETED).toBe(1);
  });

  it("shows policy, evidence, guardrail, and audit context without inventing clinical qualification", async () => {
    const policy = await createPolicy(owner(), organizationId, { code: `P14-${Date.now()}`, title: "Phase 14 employer policy", requiresAcknowledgment: true });
    const version = await createPolicyVersion(owner(), organizationId, policy.id, { effectiveFrom: new Date("2026-01-01"), body: "A versioned employer policy requiring acknowledgment." });
    await publishPolicyVersion(owner(), organizationId, version.id);
    const assigned = await assignPolicy(owner(), organizationId, employeeId, version.id, "MANUAL");
    policyAssignmentId = assigned.id;
    let detail = await getEmployerEmployeeDetail(owner(), organizationId, employeeId);
    expect(detail.profile.employee.policyAssignments[0].status).toBe("PENDING");
    expect(detail.medication.pathways).toHaveLength(0);
    expect(detail.audit.requirementCount).toBeGreaterThanOrEqual(0);
    await acknowledgePolicy(employeeUser(), organizationId, policyAssignmentId, { typedName: "Employer Workflow" });
    detail = await getEmployerEmployeeDetail(owner(), organizationId, employeeId);
    expect(detail.profile.employee.policyAssignments[0].status).toBe("ACKNOWLEDGED");
    expect(detail.profile.serviceAssignments).toEqual([]);
    expect(await db.trainingCompletion.findUnique({ where: { assignmentId } })).not.toBeNull();
  });

  it("provides dashboard metrics and bounded, filtered workforce projections", async () => {
    const dashboard = await getEmployerDashboard(owner(), organizationId);
    expect(dashboard.activeWorkforce).toBe(1);
    expect(dashboard.invitations.ACCEPTED).toBe(1);
    const page = await getWorkforceDirectory(owner(), organizationId, { status: "ACTIVE", pageSize: 250 });
    expect(page.pageSize).toBe(100);
    expect(page.items.map(item => item.id)).toContain(employeeId);
  });

  it("enforces admin RBAC and keeps clinical actions separately privileged", async () => {
    await expect(getEmployerDashboard({ id: viewerId }, organizationId)).rejects.toThrow(/compliance.operations.read/);
    await expect(getWorkforceDirectory(employeeUser(), organizationId)).rejects.toThrow(/compliance.operations.read/);
    await expect(inviteEmployeeToPortal({ id: viewerId }, organizationId, employeeId)).rejects.toThrow(/employee.manage/);
    await expect(approveClinicalCurriculum(employeeUser(), organizationId, courseVersionId, { credentialId: employeeId, typedName: "Employee", statement: "I improperly approve clinical content." })).rejects.toThrow();
  });

  it("rejects cross-tenant reads, invitation, and training assignment", async () => {
    const foreign = await db.employee.findFirstOrThrow({ where: { organizationId: otherOrganizationId } });
    await expect(getEmployerDashboard(owner(), otherOrganizationId)).rejects.toThrow();
    await expect(getEmployerEmployeeDetail(owner(), organizationId, foreign.id)).rejects.toThrow();
    await expect(inviteEmployeeToPortal(owner(), organizationId, foreign.id)).rejects.toThrow();
    await expect(createManualAssignment(owner(), organizationId, { employeeId: foreign.id, courseVersionId })).rejects.toThrow();
  });
});
