import type { ComplianceIssueType, User } from "@prisma/client";
import { reconcileOrganizationIssues } from "@/domain/compliance-issues/service";
import { resolvePermissionCodes, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";
import { getOrganizationRenewalActions } from "@/domain/clients/renewals";
import { getOrganizationDocumentRequestActions } from "@/domain/clients/document-requests";

export const ACTION_CENTER_VERSION = "phase17-v1";
export const ACTION_CENTER_DUE_SOON_DAYS = 30;
const DAY = 86_400_000;

export type ActionCategory = "TRAINING" | "POLICY" | "COMPETENCY" | "EVIDENCE" | "CREDENTIAL" | "MEDICATION_CLINICAL" | "SERVICE_ASSIGNMENT" | "GENERAL_COMPLIANCE";
export type DeadlineState = "OVERDUE" | "DUE_SOON" | "FUTURE" | "NO_DEADLINE" | "REQUIRES_REVIEW";
export type ActionCenterFilters = {
  search?: string;
  employeeId?: string;
  category?: ActionCategory;
  status?: "OPEN" | "IN_PROGRESS" | "REVIEW_REQUIRED";
  deadlineState?: DeadlineState;
  page?: number;
  pageSize?: number;
};

const medicationTypes: ComplianceIssueType[] = ["PERSON_SPECIFIC_INSTRUCTION_REQUIRED", "MEDICATION_QUALIFICATION_INCOMPLETE", "MEDICATION_AUTHORIZATION_MISSING", "CLINICAL_SIGNOFF_REQUIRED"];
const serviceTypes: ComplianceIssueType[] = ["ASSIGNMENT_BLOCKED", "ACTIVE_ASSIGNMENT_BECAME_BLOCKED"];
const categoryFor = (type: ComplianceIssueType): ActionCategory => (type.startsWith("TRAINING_") ? "TRAINING" : type === "POLICY_ACKNOWLEDGMENT_REQUIRED" ? "POLICY" : type === "COMPETENCY_REQUIRED" ? "COMPETENCY" : type.startsWith("CREDENTIAL_") ? "CREDENTIAL" : medicationTypes.includes(type) ? "MEDICATION_CLINICAL" : serviceTypes.includes(type) ? "SERVICE_ASSIGNMENT" : "GENERAL_COMPLIANCE");
export function deadlineState(dueAt: Date | null, at = new Date(), reviewRequired = false): DeadlineState {
  if (!dueAt) return reviewRequired ? "REQUIRES_REVIEW" : "NO_DEADLINE";
  if (dueAt < at) return "OVERDUE";
  return dueAt <= new Date(at.getTime() + ACTION_CENTER_DUE_SOON_DAYS * DAY) ? "DUE_SOON" : "FUTURE";
}
const text = (value: unknown) => (Array.isArray(value) ? value.map(String).join(", ") : typeof value === "string" ? value : "");
const nextAction = (category: ActionCategory) => (category === "MEDICATION_CLINICAL" ? "Open the employee record and route the required action to an authorized clinical professional." : category === "SERVICE_ASSIGNMENT" ? "Open the employee record and correct the underlying prerequisite; assignment guardrails cannot be overridden here." : category === "POLICY" ? "Open the employee record and direct the employee to acknowledge the policy." : category === "COMPETENCY" ? "Open the employee record and use the authorized competency workflow." : category === "CREDENTIAL" ? "Open the employee record and submit or verify valid credential evidence." : category === "TRAINING" ? "Open the employee record and use the existing training workflow." : "Open the employee record and address the authoritative source state.");

async function authorize(user: Pick<User, "id">, organizationId: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, "compliance.operations.read");
  return {
    membership,
    permissions: await resolvePermissionCodes(membership.id),
  };
}

export async function getActionCenter(user: Pick<User, "id">, organizationId: string, filters: ActionCenterFilters = {}, at = new Date()) {
  const { permissions } = await authorize(user, organizationId);
  const page = Math.max(1, Math.floor(filters.page ?? 1)),
    pageSize = Math.max(1, Math.min(Math.floor(filters.pageSize ?? 25), 100));
  const [issues, evidence, training, policies, competencies, activity] = await Promise.all([
    prisma.complianceIssue.findMany({
      where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
      },
      orderBy: [{ dueAt: "asc" }, { firstDetectedAt: "asc" }, { id: "asc" }],
      take: 2000,
    }),
    prisma.externalTrainingRecord.findMany({
      where: {
        organizationId,
        reviewStatus: { in: ["PENDING", "NEEDS_MORE_INFORMATION"] },
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
        equivalencyDecisions: {
          include: { requirementVersion: { include: { requirement: true } } },
          orderBy: { decidedAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1000,
    }),
    prisma.trainingAssignment.findMany({
      where: {
        organizationId,
        status: {
          in: ["NOT_STARTED", "IN_PROGRESS", "TRAINING_COMPLETE_COMPETENCY_PENDING", "FAILED"],
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
        courseVersion: { include: { course: true } },
        attempts: {
          where: { submittedAt: { not: null }, passed: false },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }, { id: "asc" }],
      take: 2000,
    }),
    prisma.policyAssignment.findMany({
      where: { organizationId, status: { in: ["PENDING", "OVERDUE"] } },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
        policyVersion: { include: { policy: true } },
      },
      orderBy: [{ dueAt: "asc" }, { assignedAt: "asc" }, { id: "asc" }],
      take: 2000,
    }),
    prisma.competencyAssessment.findMany({
      where: {
        organizationId,
        OR: [
          { status: { in: ["DRAFT", "IN_PROGRESS"] } },
          {
            status: "FINALIZED",
            result: { in: ["FAIL", "REMEDIATION_REQUIRED", "INCOMPLETE"] },
          },
        ],
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
          },
        },
        competencyDefinition: true,
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      take: 1000,
    }),
    prisma.auditEvent.findMany({
      where: { organizationId },
      include: { actor: { select: { email: true } } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 25,
    }),
  ]);
  const issueSources = new Set(issues.map((issue) => `${issue.sourceType}:${issue.sourceId}`));
  const actions = [
    ...issues.map((issue) => {
      const category = categoryFor(issue.issueType),
        reasons = text(issue.reasonCodesJson);
      return {
        id: `issue:${issue.id}`,
        sourceType: "ComplianceIssue",
        sourceId: issue.id,
        employee: issue.employee,
        category,
        actionType: issue.issueType,
        status: issue.status,
        deadlineState: deadlineState(issue.dueAt, at, !issue.dueAt && reasons.includes("REQUIRED")),
        dueAt: issue.dueAt?.toISOString() ?? null,
        priority: issue.priority,
        reason: reasons || "An authoritative compliance issue remains unresolved.",
        remediationState: issue.status === "IN_PROGRESS" ? "IN_PROGRESS" : "NOT_STARTED",
        nextAction: nextAction(category),
        clinicallyPrivileged: category === "MEDICATION_CLINICAL",
        serviceOverrideAllowed: false,
        employeeHref: `/admin/compliance-operations?employeeId=${issue.employeeId}`,
      };
    }),
    ...evidence.map((record) => ({
      id: `evidence:${record.id}`,
      sourceType: "ExternalTrainingRecord",
      sourceId: record.id,
      employee: record.employee,
      category: "EVIDENCE" as const,
      actionType: "EXTERNAL_EVIDENCE_REVIEW",
      status: "REVIEW_REQUIRED",
      deadlineState: "REQUIRES_REVIEW" as const,
      dueAt: null,
      priority: null,
      reason: `${record.trainingName} from ${record.providerName} requires review.`,
      remediationState: record.reviewStatus,
      nextAction: permissions.has("training.equivalency.review") ? "Review against a specific requirement using the existing equivalency workflow." : "Route to a reviewer with training equivalency permission.",
      clinicallyPrivileged: false,
      serviceOverrideAllowed: false,
      employeeHref: `/admin/compliance-operations?employeeId=${record.employeeId}`,
    })),
    ...training
      .filter((row) => !issueSources.has(`TrainingAssignment:${row.id}`) && !issueSources.has(`ComplianceInstance:${row.complianceInstanceId}`))
      .map((row) => ({
        id: `training:${row.id}`,
        sourceType: "TrainingAssignment",
        sourceId: row.id,
        employee: row.employee,
        category: "TRAINING" as const,
        actionType: row.attempts.length ? "FAILED_ASSESSMENT_RETRY" : row.status,
        status: "OPEN",
        deadlineState: deadlineState(row.dueAt, at),
        dueAt: row.dueAt?.toISOString() ?? null,
        priority: null,
        reason: `${row.courseVersion.course.title} is ${row.status.toLowerCase().replaceAll("_", " ")}.`,
        remediationState: "NOT_STARTED",
        nextAction: nextAction("TRAINING"),
        clinicallyPrivileged: false,
        serviceOverrideAllowed: false,
        employeeHref: `/admin/compliance-operations?employeeId=${row.employeeId}`,
      })),
    ...policies
      .filter((row) => !issueSources.has(`PolicyAssignment:${row.id}`))
      .map((row) => ({
        id: `policy:${row.id}`,
        sourceType: "PolicyAssignment",
        sourceId: row.id,
        employee: row.employee,
        category: "POLICY" as const,
        actionType: "POLICY_ACKNOWLEDGMENT_REQUIRED",
        status: "OPEN",
        deadlineState: deadlineState(row.dueAt, at),
        dueAt: row.dueAt?.toISOString() ?? null,
        priority: null,
        reason: `${row.policyVersion.policy.title} has not been acknowledged.`,
        remediationState: "NOT_STARTED",
        nextAction: nextAction("POLICY"),
        clinicallyPrivileged: false,
        serviceOverrideAllowed: false,
        employeeHref: `/admin/compliance-operations?employeeId=${row.employeeId}`,
      })),
    ...competencies
      .filter((row) => !issueSources.has(`ComplianceInstance:${row.complianceInstanceId}`))
      .map((row) => ({
        id: `competency:${row.id}`,
        sourceType: "CompetencyAssessment",
        sourceId: row.id,
        employee: row.employee,
        category: "COMPETENCY" as const,
        actionType: row.result ?? row.status,
        status: "OPEN",
        deadlineState: "NO_DEADLINE" as const,
        dueAt: null,
        priority: null,
        reason: `${row.competencyDefinition.name} assessment requires attention; training completion does not substitute for competency evidence.`,
        remediationState: row.status,
        nextAction: nextAction("COMPETENCY"),
        clinicallyPrivileged: false,
        serviceOverrideAllowed: false,
        employeeHref: `/admin/compliance-operations?employeeId=${row.employeeId}`,
      })),
  ];
  const rank: Record<DeadlineState, number> = {
    OVERDUE: 0,
    DUE_SOON: 1,
    FUTURE: 2,
    REQUIRES_REVIEW: 3,
    NO_DEADLINE: 4,
  };
  actions.sort((a, b) => rank[a.deadlineState] - rank[b.deadlineState] || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.id.localeCompare(b.id));
  const query = filters.search?.trim().toLocaleLowerCase();
  const filtered = actions.filter((item) => (!filters.employeeId || item.employee.id === filters.employeeId) && (!filters.category || item.category === filters.category) && (!filters.status || item.status === filters.status) && (!filters.deadlineState || item.deadlineState === filters.deadlineState) && (!query || `${item.employee.firstName} ${item.employee.lastName} ${item.employee.employeeNumber ?? ""} ${item.reason} ${item.actionType}`.toLocaleLowerCase().includes(query)));
  const uniqueEmployees = new Set(actions.map((item) => item.employee.id));
  const count = (predicate: (item: (typeof actions)[number]) => boolean) => actions.filter(predicate).length;
  const rawRenewals = permissions.has("client.read") ? await getOrganizationRenewalActions(user, organizationId, at) : [],
    allDocumentRequests = permissions.has("client.read") ? await getOrganizationDocumentRequestActions(organizationId, at) : [],
    requestByObligation = new Map<string, typeof allDocumentRequests>();
  for (const request of allDocumentRequests) if (request.obligationDocumentId) requestByObligation.set(request.obligationDocumentId, [...(requestByObligation.get(request.obligationDocumentId) ?? []), request]);
  const clientDocumentRenewals = rawRenewals.map((item) => ({
      ...item,
      requests: requestByObligation.get(item.documentId) ?? [],
    })),
    renewalIds = new Set(rawRenewals.map((item) => item.documentId)),
    clientDocumentRequests = allDocumentRequests.filter((item) => !item.obligationDocumentId || !renewalIds.has(item.obligationDocumentId));
  const renewalOverdue = clientDocumentRenewals.filter((item) => item.status === "OVERDUE").length,
    renewalDueSoon = clientDocumentRenewals.filter((item) => item.status === "DUE_SOON").length;
  return {
    schemaVersion: ACTION_CENTER_VERSION,
    organizationId,
    evaluatedAt: at.toISOString(),
    dueSoonDays: ACTION_CENTER_DUE_SOON_DAYS,
    summary: {
      employeesRequiringAttention: uniqueEmployees.size,
      openActions: actions.length + clientDocumentRenewals.length + clientDocumentRequests.length,
      openComplianceIssues: issues.length,
      overdue: count((item) => item.deadlineState === "OVERDUE") + renewalOverdue + clientDocumentRequests.filter((item) => item.deadlineState === "OVERDUE").length,
      dueSoon: count((item) => item.deadlineState === "DUE_SOON") + renewalDueSoon + clientDocumentRequests.filter((item) => item.deadlineState === "DUE_SOON").length,
      clientDocumentRenewals: clientDocumentRenewals.length,
      clientDocumentRequests: clientDocumentRequests.length,
      trainingActions: count((item) => item.category === "TRAINING"),
      policyActions: count((item) => item.category === "POLICY"),
      competencyActions: count((item) => item.category === "COMPETENCY"),
      evidenceAwaitingReview: evidence.length,
      medicationClinicalActions: count((item) => item.category === "MEDICATION_CLINICAL"),
      serviceAssignmentBlockers: count((item) => item.category === "SERVICE_ASSIGNMENT"),
      remediationInProgress: count((item) => item.remediationState === "IN_PROGRESS"),
    },
    filters: {
      page,
      pageSize,
      total: filtered.length,
      pages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    },
    actions: filtered.slice((page - 1) * pageSize, page * pageSize),
    clientDocumentRenewals,
    clientDocumentRequests,
    evidenceReview: evidence.map((record) => ({
      id: record.id,
      employee: record.employee,
      evidenceType: "EXTERNAL_TRAINING",
      source: record.providerName,
      title: record.trainingName,
      submittedAt: record.createdAt.toISOString(),
      trainingDate: record.trainingDate.toISOString(),
      reviewState: record.reviewStatus,
      requirementContext: record.equivalencyDecisions[0]?.requirementVersion.requirement.name ?? null,
      reviewerActionAvailable: permissions.has("training.equivalency.review"),
      clinicallyPrivileged: false,
    })),
    recentActivity: activity.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      employeeId: event.employeeId,
      actor: event.actor?.email ?? "System",
      occurredAt: event.occurredAt.toISOString(),
    })),
    emptyState: actions.length || clientDocumentRenewals.length || clientDocumentRequests.length ? null : "No open compliance issues or operational actions detected from currently available platform data. This is not a legal certification.",
  };
}

export async function refreshActionCenter(user: Pick<User, "id">, organizationId: string, at = new Date()) {
  await authorize(user, organizationId);
  const result = await reconcileOrganizationIssues(user, organizationId, at);
  return {
    ...result,
    actionCenter: await getActionCenter(user, organizationId, {}, at),
  };
}
