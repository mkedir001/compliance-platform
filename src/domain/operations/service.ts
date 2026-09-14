import type { BlockingScope, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { computeEmployeeWorkReadiness } from "@/domain/readiness/service";
import { computeEmployeeOperationalProfile, getOrganizationComplianceOperations, type OperationalStatus } from "@/domain/compliance/operations/service";
import { listMedicationQualifications } from "@/domain/medication/service";

export async function getComplianceOperationsSummary(user: Pick<User,"id">, organizationId: string, at = new Date(), filters: { status?: OperationalStatus; scope?: BlockingScope } = {}) {
  const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, "compliance.operations.read");
  const soon = new Date(at.getTime() + 30 * 86400000);
  const [onboarding, overdue, trainingDueSoon, trainingOverdue, competencyPending, policyPending, credentialsExpiring, certificateGroups] = await Promise.all([
    prisma.employeeOnboarding.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    prisma.complianceInstance.count({ where: { organizationId, status: { in: ["PAST_DUE", "BLOCKED"] } } }),
    prisma.trainingAssignment.count({ where: { organizationId, status: { in: ["NOT_STARTED", "IN_PROGRESS", "TRAINING_COMPLETE_COMPETENCY_PENDING"] }, dueAt: { gte: at, lte: soon } } }),
    prisma.trainingAssignment.count({ where: { organizationId, status: { in: ["NOT_STARTED", "IN_PROGRESS", "TRAINING_COMPLETE_COMPETENCY_PENDING"] }, dueAt: { lt: at } } }),
    prisma.trainingAssignment.count({ where: { organizationId, status: "TRAINING_COMPLETE_COMPETENCY_PENDING" } }),
    prisma.policyAssignment.count({ where: { organizationId, status: { in: ["PENDING", "OVERDUE"] } } }),
    prisma.professionalCredential.count({ where: { organizationId, status: "ACTIVE", expiresAt: { gte: at, lte: soon } } }),
    prisma.certificate.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
  ]);
  const workforce = await getOrganizationComplianceOperations(user, organizationId, filters, at);
  const medicationStates = (await Promise.all(workforce.workers.map(row => listMedicationQualifications(user, organizationId, row.employee.id, at)))).flat();
  const medication = Object.fromEntries([...new Set(medicationStates.map(item => item.state))].map(state => [state, medicationStates.filter(item => item.state === state).length]));
  return { asOf: at.toISOString(), onboarding: Object.fromEntries(onboarding.map(x => [x.status, x._count])), overdueCompliance: overdue, trainingDueSoon, trainingOverdue, competencyPending, policyAcknowledgmentsPending: policyPending, credentialsExpiring, certificates: Object.fromEntries(certificateGroups.map(x => [x.status, x._count])), medication, workforce };
}

export async function getEmployeeComplianceProfile(user: Pick<User,"id">, organizationId: string, employeeId: string, at = new Date()) {
  const { employee } = await requireEmployeeAccess(user, organizationId, employeeId, "onboarding.read");
  const detail = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id }, include: {
    serviceEvents: true, duties: { include: { dutyDefinition: true } }, roles: { include: { roleDefinition: true } },
    complianceInstances: { include: { requirementVersion: { include: { requirement: true } }, evidence: true } },
    trainingAssignments: { include: { courseVersion: { include: { course: true } }, completion: true } }, trainingCompletions: true,
    competencyAssessments: { include: { competencyDefinition: true } }, professionalCredentials: true,
    policyAssignments: { include: { policyVersion: { include: { policy: true } }, attestation: true } }, certificates: true,
    onboardings: { include: { steps: { include: { stepDefinition: true } }, templateVersion: { include: { onboardingTemplate: true } } } },
    workReadinessEvaluations: { orderBy: { evaluatedAt: "desc" }, take: 10 },
  } });
  const timeline = [
    { type: "EMPLOYEE_CREATED", occurredAt: detail.createdAt, resourceType: "Employee", resourceId: detail.id },
    ...detail.serviceEvents.map(x => ({ type: `SERVICE_EVENT_${x.eventType}`, occurredAt: x.occurredAt, resourceType: "EmployeeServiceEvent", resourceId: x.id })),
    ...detail.complianceInstances.map(x => ({ type: "COMPLIANCE_REQUIREMENT_GENERATED", occurredAt: x.createdAt, resourceType: "ComplianceInstance", resourceId: x.id })),
    ...detail.trainingAssignments.map(x => ({ type: "TRAINING_ASSIGNED", occurredAt: x.assignedAt, resourceType: "TrainingAssignment", resourceId: x.id })),
    ...detail.trainingCompletions.map(x => ({ type: "TRAINING_COMPLETED", occurredAt: x.completedAt, resourceType: "TrainingCompletion", resourceId: x.id })),
    ...detail.competencyAssessments.filter(x => x.finalizedAt).map(x => ({ type: `COMPETENCY_${x.result}`, occurredAt: x.finalizedAt!, resourceType: "CompetencyAssessment", resourceId: x.id })),
    ...detail.policyAssignments.map(x => ({ type: x.acknowledgedAt ? "POLICY_ACKNOWLEDGED" : "POLICY_ASSIGNED", occurredAt: x.acknowledgedAt ?? x.assignedAt, resourceType: "PolicyAssignment", resourceId: x.id })),
    ...detail.certificates.map(x => ({ type: `CERTIFICATE_${x.status}`, occurredAt: x.issuedAt, resourceType: "Certificate", resourceId: x.id })),
    ...detail.workReadinessEvaluations.map(x => ({ type: "READINESS_EVALUATED", occurredAt: x.evaluatedAt, resourceType: "WorkReadinessEvaluation", resourceId: x.id })),
  ].sort((a,b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  return { employee: detail, readiness: await computeEmployeeWorkReadiness(organizationId, employeeId, at), operationalCompliance: await computeEmployeeOperationalProfile(organizationId, employeeId, at), medication: await listMedicationQualifications(user, organizationId, employeeId, at), timeline };
}
