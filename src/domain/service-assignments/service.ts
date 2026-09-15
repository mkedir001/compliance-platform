import { Prisma, type AssignmentEligibilityTrigger, type BlockingScope, type User } from "@prisma/client";
import { z } from "zod";
import { AuthorizationError, ResourceNotFoundError } from "@/domain/auth/errors";
import { evaluateServiceEligibility } from "@/domain/compliance/operations/service";
import { evaluateMedicationDutyEligibility } from "@/domain/medication/service";
import { requireEmployeeAccess, requireOrganizationAccess, requirePermission } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";

export const ASSIGNMENT_ELIGIBILITY_ENGINE_VERSION = "phase10-v1";
const hardMedicationReasons = new Set(["MEDICATION_TRAINING_REQUIRED", "MEDICATION_TRAINING_INCOMPLETE", "KNOWLEDGE_ASSESSMENT_REQUIRED", "CLINICAL_CURRICULUM_APPROVAL_REQUIRED", "OBSERVED_SKILL_ASSESSMENT_REQUIRED", "OBSERVED_SKILL_ASSESSMENT_FAILED", "CLINICAL_SIGNOFF_REQUIRED", "QUALIFICATION_EXPIRED", "QUALIFICATION_REVOKED", "PERSON_SPECIFIC_INSTRUCTION_REQUIRED", "AUTHORIZATION_REQUIRED", "DELEGATION_REQUIRED", "MEDICATION_DUTY_ASSIGNMENT_REQUIRED"]);

const proposalSchema = z.object({
  employeeId: z.string().cuid(),
  programId: z.string().cuid().optional(),
  locationId: z.string().cuid().optional(),
  serviceRecipientRef: z.string().trim().min(1).max(255).optional(),
  blockingScope: z.enum(["GENERAL_WORK", "DIRECT_CONTACT", "UNSUPERVISED_CONTACT", "PERSON_SPECIFIC_TASK", "MEDICATION_ADMINISTRATION"]).default("GENERAL_WORK"),
  medicationPathwayId: z.string().cuid().optional(),
  dutyDefinitionIds: z.array(z.string().cuid()).max(50).default([]),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  overrideReason: z.string().trim().min(10).max(2000).optional(),
}).refine(value => !value.endsAt || value.endsAt > value.startsAt, { message: "endsAt must be after startsAt" });

type Proposal = z.infer<typeof proposalSchema>;
type RuleSnapshot = { id: string; requirementVersionId: string | null; medicationPathwayId: string | null; blockingScope: BlockingScope };

async function authorize(user: Pick<User, "id">, organizationId: string, permission: "service_assignment.read" | "service_assignment.manage") {
  const { membership } = await requireOrganizationAccess(user, organizationId); await requirePermission(membership.id, permission); return membership;
}

async function resolveContext(organizationId: string, input: Proposal) {
  const [employee, program, location, duties, pathway] = await Promise.all([
    prisma.employee.findFirst({ where: { id: input.employeeId, organizationId } }),
    input.programId ? prisma.program.findFirst({ where: { id: input.programId, organizationId, status: "ACTIVE" } }) : null,
    input.locationId ? prisma.location.findFirst({ where: { id: input.locationId, organizationId, status: "ACTIVE" } }) : null,
    prisma.dutyDefinition.findMany({ where: { id: { in: input.dutyDefinitionIds } } }),
    input.medicationPathwayId ? prisma.medicationQualificationPathway.findFirst({ where: { id: input.medicationPathwayId, organizationId } }) : null,
  ]);
  if (!employee) throw new ResourceNotFoundError("Employee not found");
  if (input.programId && !program) throw new ResourceNotFoundError("Service/program not found");
  if (input.locationId && !location) throw new ResourceNotFoundError("Location not found");
  if (duties.length !== new Set(input.dutyDefinitionIds).size) throw new ResourceNotFoundError("Duty definition not found");
  const medicationDuty = input.blockingScope === "MEDICATION_ADMINISTRATION" || duties.some(duty => duty.code === "MEDICATION_ADMINISTRATION");
  if (medicationDuty && !pathway) throw new AuthorizationError("A governed medication qualification pathway is required for medication-duty eligibility");
  return { employee, medicationDuty };
}

async function matchingRules(organizationId: string, input: Proposal): Promise<RuleSnapshot[]> {
  return prisma.serviceAssignmentRequirementRule.findMany({ where: {
    organizationId, status: "ACTIVE",
    AND: [
      { OR: [{ programId: null }, { programId: input.programId ?? "__none__" }] },
      { OR: [{ locationId: null }, { locationId: input.locationId ?? "__none__" }] },
      { OR: [{ serviceRecipientRef: null }, { serviceRecipientRef: input.serviceRecipientRef ?? "__none__" }] },
      { OR: [{ dutyDefinitionId: null }, { dutyDefinitionId: { in: input.dutyDefinitionIds } }] },
    ],
  }, select: { id: true, requirementVersionId: true, medicationPathwayId: true, blockingScope: true } });
}

async function computeDecision(user: Pick<User, "id">, organizationId: string, input: Proposal, evaluatedAt = new Date()) {
  const context = await resolveContext(organizationId, input), rules = await matchingRules(organizationId, input);
  const configuredRequirementIds = [...new Set(rules.flatMap(rule => rule.requirementVersionId ? [rule.requirementVersionId] : []))];
  const compliance = await evaluateServiceEligibility(user, organizationId, input.employeeId, input.blockingScope, evaluatedAt);
  const configuredInstances = configuredRequirementIds.length ? await prisma.complianceInstance.findMany({ where: { organizationId, employeeId: input.employeeId, requirementVersionId: { in: configuredRequirementIds }, status: { not: "SUPERSEDED" } }, include: { evidence: true, requirementVersion: { include: { competencyRequirements: true } }, trainingAssignments: { include: { completion: true } }, competencyAssessments: true } }) : [];
  const reasons = [...compliance.reasonCodes.filter(reason => reason !== "EVIDENCE_COMPLETE_AUTHORIZATION_NOT_IMPLEMENTED")];
  for (const requirementId of configuredRequirementIds) {
    const instance = configuredInstances.find(item => item.requirementVersionId === requirementId);
    if (!instance) reasons.push("REQUIREMENT_EVIDENCE_UNAVAILABLE");
    else if (!["SATISFIED", "WAIVED_BY_EQUIVALENCY"].includes(instance.status)) {
      const competencyRequired = instance.requirementVersion.competencyRequirements.some(item => item.required);
      if (competencyRequired && !instance.competencyAssessments.some(item => item.status === "FINALIZED" && item.result === "PASS")) reasons.push("REQUIRED_COMPETENCY_MISSING");
      else if (!instance.trainingAssignments.length) reasons.push("REQUIRED_TRAINING_MISSING");
      else if (instance.trainingAssignments.some(item => !item.completion)) reasons.push("REQUIRED_TRAINING_INCOMPLETE");
      else reasons.push("REQUIREMENT_EVIDENCE_UNAVAILABLE");
    }
  }
  const pathwayIds = [...new Set([...(input.medicationPathwayId ? [input.medicationPathwayId] : []), ...rules.flatMap(rule => rule.medicationPathwayId ? [rule.medicationPathwayId] : [])])];
  const medicationResults = context.medicationDuty ? await Promise.all(pathwayIds.map(pathwayId => evaluateMedicationDutyEligibility(user, organizationId, input.employeeId, pathwayId, input.serviceRecipientRef, evaluatedAt))) : [];
  for (const result of medicationResults) reasons.push(...result.reasonCodes);
  if (context.employee.employmentStatus !== "ACTIVE") reasons.push("EMPLOYEE_INACTIVE");
  const uniqueReasons = [...new Set(reasons)], eligible = uniqueReasons.length === 0 && (!context.medicationDuty || medicationResults.length > 0 && medicationResults.every(result => result.eligible));
  return {
    eligible,
    decision: eligible ? "ELIGIBLE" as const : "BLOCKED" as const,
    evaluatedAt: evaluatedAt.toISOString(), employeeId: input.employeeId, organizationId,
    context: { programId: input.programId ?? null, locationId: input.locationId ?? null, serviceRecipientRef: input.serviceRecipientRef ?? null, blockingScope: input.blockingScope, dutyDefinitionIds: input.dutyDefinitionIds, medicationPathwayIds: pathwayIds },
    applicableRequirements: [...new Set([...compliance.applicableRequirements, ...configuredRequirementIds])],
    blockingRequirements: [...new Set([...compliance.blockingRequirements, ...configuredRequirementIds.filter(id => !configuredInstances.some(item => item.requirementVersionId === id && ["SATISFIED", "WAIVED_BY_EQUIVALENCY"].includes(item.status)))])],
    reasonCodes: uniqueReasons,
    hardNonOverridable: uniqueReasons.length > 0,
    medicationSafeguards: medicationResults,
    evidenceBasis: { compliance: compliance.evidenceBasis, configuredRequirements: configuredInstances.map(item => ({ complianceInstanceId: item.id, requirementVersionId: item.requirementVersionId, status: item.status, evidence: item.evidence.map(link => ({ type: link.evidenceType, referenceId: link.evidenceReferenceId })) })) },
    disclaimer: "Platform-derived assignment eligibility based on configured requirements and recorded evidence; not a legal opinion.",
  };
}

async function persistEvaluation(userId: string, organizationId: string, input: Proposal, result: Awaited<ReturnType<typeof computeDecision>>, trigger: AssignmentEligibilityTrigger, assignmentId?: string, previousEvaluationId?: string) {
  return prisma.serviceAssignmentEligibilityEvaluation.create({ data: { organizationId, employeeId: input.employeeId, assignmentId, actorUserId: userId, trigger, decision: result.decision, evaluatedAt: new Date(result.evaluatedAt), engineVersion: ASSIGNMENT_ELIGIBILITY_ENGINE_VERSION, inputSnapshot: input as unknown as Prisma.InputJsonValue, resultSnapshot: result as unknown as Prisma.InputJsonValue, previousEvaluationId } });
}

export async function evaluateProposedAssignment(user: Pick<User, "id">, organizationId: string, raw: unknown) {
  const membership = await authorize(user, organizationId, "service_assignment.manage"), input = proposalSchema.parse(raw);
  await requirePermission(membership.id, "compliance.operations.read"); await requireEmployeeAccess(user, organizationId, input.employeeId, "employee.read");
  const result = await computeDecision(user, organizationId, input);
  if (input.overrideReason) {
    await requirePermission(membership.id, "service_assignment.override");
    result.reasonCodes = [...new Set([...result.reasonCodes, "OVERRIDE_REJECTED_NON_OVERRIDABLE_COMPLIANCE_GUARDRAIL"])]; result.eligible = false; result.decision = "BLOCKED";
  }
  const evaluation = await persistEvaluation(user.id, organizationId, input, result, input.overrideReason ? "OVERRIDE_ATTEMPT" : "PROPOSAL");
  await prisma.serviceAssignmentEvent.create({ data: { organizationId, actorUserId: user.id, action: input.overrideReason ? "assignment.override_rejected" : result.eligible ? "assignment.proposed_eligible" : "assignment.proposed_blocked", metadata: { evaluationId: evaluation.id, reasonCodes: result.reasonCodes, overrideReason: input.overrideReason } } });
  return { evaluationId: evaluation.id, ...result };
}

export async function createServiceAssignment(user: Pick<User, "id">, organizationId: string, raw: unknown) {
  const membership = await authorize(user, organizationId, "service_assignment.manage"), input = proposalSchema.parse(raw);
  await requirePermission(membership.id, "compliance.operations.read"); await requireEmployeeAccess(user, organizationId, input.employeeId, "employee.read");
  const result = await computeDecision(user, organizationId, input);
  if (input.overrideReason) {
    await requirePermission(membership.id, "service_assignment.override");
    result.reasonCodes = [...new Set([...result.reasonCodes, "OVERRIDE_REJECTED_NON_OVERRIDABLE_COMPLIANCE_GUARDRAIL"])]; result.eligible = false; result.decision = "BLOCKED";
  }
  const rules = await matchingRules(organizationId, input), requirementIds = [...new Set(rules.flatMap(rule => rule.requirementVersionId ? [rule.requirementVersionId] : []))];
  return prisma.$transaction(async tx => {
    const assignment = await tx.serviceAssignment.create({ data: { organizationId, employeeId: input.employeeId, programId: input.programId, locationId: input.locationId, serviceRecipientRef: input.serviceRecipientRef, blockingScope: input.blockingScope, medicationPathwayId: input.medicationPathwayId, startsAt: input.startsAt, endsAt: input.endsAt, status: result.eligible ? "ACTIVE" : "BLOCKED", createdByUserId: user.id, activatedAt: result.eligible ? new Date(result.evaluatedAt) : null, duties: { create: input.dutyDefinitionIds.map(dutyDefinitionId => ({ dutyDefinitionId })) }, requirements: { create: requirementIds.map(requirementVersionId => ({ requirementVersionId, ruleIdSnapshot: rules.find(rule => rule.requirementVersionId === requirementVersionId)?.id })) } } });
    const evaluation = await tx.serviceAssignmentEligibilityEvaluation.create({ data: { organizationId, employeeId: input.employeeId, assignmentId: assignment.id, actorUserId: user.id, trigger: input.overrideReason ? "OVERRIDE_ATTEMPT" : "CREATION", decision: result.decision, evaluatedAt: new Date(result.evaluatedAt), engineVersion: ASSIGNMENT_ELIGIBILITY_ENGINE_VERSION, inputSnapshot: input as unknown as Prisma.InputJsonValue, resultSnapshot: result as unknown as Prisma.InputJsonValue } });
    await tx.serviceAssignmentEvent.create({ data: { organizationId, assignmentId: assignment.id, actorUserId: user.id, action: input.overrideReason ? "assignment.override_rejected" : result.eligible ? "assignment.created_active" : "assignment.created_blocked", metadata: { evaluationId: evaluation.id, reasonCodes: result.reasonCodes, overrideReason: input.overrideReason } } });
    return { assignment, evaluationId: evaluation.id, eligibility: result };
  });
}

const assignmentInclude = { duties: { include: { dutyDefinition: true } }, requirements: true, eligibilityEvaluations: { orderBy: { evaluatedAt: "asc" as const } }, events: { orderBy: { createdAt: "asc" as const } } };

export async function getServiceAssignment(user: Pick<User, "id">, organizationId: string, assignmentId: string) {
  await authorize(user, organizationId, "service_assignment.read");
  const assignment = await prisma.serviceAssignment.findFirst({ where: { id: assignmentId, organizationId }, include: assignmentInclude });
  if (!assignment) throw new ResourceNotFoundError("Service assignment not found"); return assignment;
}

export async function listServiceAssignments(user: Pick<User, "id">, organizationId: string, filters: { status?: "ACTIVE" | "BLOCKED" | "INACTIVE" | "CANCELLED"; medicationBlocked?: boolean; personSpecificBlocked?: boolean } = {}) {
  await authorize(user, organizationId, "service_assignment.read");
  const rows = await prisma.serviceAssignment.findMany({ where: { organizationId, status: filters.status }, include: { employee: true, duties: { include: { dutyDefinition: true } }, eligibilityEvaluations: { orderBy: { evaluatedAt: "desc" }, take: 1 } }, orderBy: { startsAt: "desc" } });
  return rows.filter(row => { const snapshot = row.eligibilityEvaluations[0]?.resultSnapshot as { reasonCodes?: string[] } | undefined, reasons = snapshot?.reasonCodes ?? []; return (!filters.medicationBlocked || reasons.some(reason => hardMedicationReasons.has(reason))) && (!filters.personSpecificBlocked || reasons.includes("PERSON_SPECIFIC_INSTRUCTION_REQUIRED")); });
}

function assignmentToProposal(assignment: Awaited<ReturnType<typeof getServiceAssignment>>): Proposal { return { employeeId: assignment.employeeId, programId: assignment.programId ?? undefined, locationId: assignment.locationId ?? undefined, serviceRecipientRef: assignment.serviceRecipientRef ?? undefined, blockingScope: assignment.blockingScope, medicationPathwayId: assignment.medicationPathwayId ?? undefined, dutyDefinitionIds: assignment.duties.map(item => item.dutyDefinitionId), startsAt: assignment.startsAt, endsAt: assignment.endsAt ?? undefined }; }

export async function reevaluateServiceAssignment(user: Pick<User, "id">, organizationId: string, assignmentId: string) {
  await authorize(user, organizationId, "service_assignment.manage"); const assignment = await getServiceAssignment(user, organizationId, assignmentId), input = assignmentToProposal(assignment), result = await computeDecision(user, organizationId, input);
  const previous = assignment.eligibilityEvaluations.at(-1), evaluation = await persistEvaluation(user.id, organizationId, input, result, "REEVALUATION", assignment.id, previous?.id);
  const changed = previous?.decision !== result.decision;
  if (!result.eligible && assignment.status === "ACTIVE") await prisma.serviceAssignment.update({ where: { id: assignment.id }, data: { status: "BLOCKED" } });
  await prisma.serviceAssignmentEvent.create({ data: { organizationId, assignmentId, actorUserId: user.id, action: changed ? "assignment.eligibility_changed" : "assignment.eligibility_reevaluated", metadata: { evaluationId: evaluation.id, priorDecision: previous?.decision, decision: result.decision, reasonCodes: result.reasonCodes } } });
  return { evaluationId: evaluation.id, changed, ...result };
}

export async function activateServiceAssignment(user: Pick<User, "id">, organizationId: string, assignmentId: string) {
  const evaluation = await reevaluateServiceAssignment(user, organizationId, assignmentId); if (!evaluation.eligible) return { assignment: await getServiceAssignment(user, organizationId, assignmentId), eligibility: evaluation };
  const assignment = await prisma.serviceAssignment.update({ where: { id: assignmentId }, data: { status: "ACTIVE", activatedAt: new Date() } });
  await prisma.serviceAssignmentEvent.create({ data: { organizationId, assignmentId, actorUserId: user.id, action: "assignment.activated", metadata: { evaluationId: evaluation.evaluationId } } }); return { assignment, eligibility: evaluation };
}

export async function cancelServiceAssignment(user: Pick<User, "id">, organizationId: string, assignmentId: string, reason: string) {
  await authorize(user, organizationId, "service_assignment.manage"); const assignment = await prisma.serviceAssignment.findFirst({ where: { id: assignmentId, organizationId } }); if (!assignment) throw new ResourceNotFoundError("Service assignment not found");
  if (assignment.status === "CANCELLED") return assignment;
  const cancelled = await prisma.serviceAssignment.update({ where: { id: assignment.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: user.id, cancellationReason: z.string().trim().min(3).max(1000).parse(reason) } });
  await prisma.serviceAssignmentEvent.create({ data: { organizationId, assignmentId, actorUserId: user.id, action: "assignment.cancelled", metadata: { reason } } }); return cancelled;
}

export async function deactivateServiceAssignment(user: Pick<User, "id">, organizationId: string, assignmentId: string, reason: string) {
  await authorize(user, organizationId, "service_assignment.manage"); const assignment = await prisma.serviceAssignment.findFirst({ where: { id: assignmentId, organizationId } }); if (!assignment) throw new ResourceNotFoundError("Service assignment not found");
  const explanation = z.string().trim().min(3).max(1000).parse(reason);
  if (assignment.status === "INACTIVE") return assignment;
  const inactive = await prisma.serviceAssignment.update({ where: { id: assignment.id }, data: { status: "INACTIVE" } });
  await prisma.serviceAssignmentEvent.create({ data: { organizationId, assignmentId, actorUserId: user.id, action: "assignment.deactivated", metadata: { reason: explanation } } }); return inactive;
}
