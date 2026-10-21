import type { User } from "@prisma/client";
import { ConflictError, ResourceNotFoundError, ValidationError } from "@/domain/auth/errors";
import { serviceTypeOptions } from "@/domain/clients/intake-state";
import { requireOrganizationAccess, requirePermission, resolvePermissionCodes } from "@/domain/permissions/authorization";
import { prisma } from "@/lib/prisma";
import { getAxisCareConnectionStatus, loadAxisCareConfig, recordAxisCareConnectionTest } from "./config";
import { runFullSync, testConnection } from "./sync";
import { operationalEmployeeWhere } from "@/domain/test-data/visibility";

async function authorize(user: Pick<User, "id">, organizationId: string, permission: "organization.manage" | "billing.mapping.manage" | "billing.sync.manage") {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  await requirePermission(membership.id, permission);
}

async function authorizeIntegrationRead(user: Pick<User, "id">, organizationId: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId), permissions = await resolvePermissionCodes(membership.id);
  if (!["organization.manage", "billing.mapping.manage", "billing.sync.manage"].some(code => permissions.has(code))) await requirePermission(membership.id, "billing.mapping.manage");
}

const identity = (payload: unknown) => {
  const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  return { firstName: typeof value.firstName === "string" ? value.firstName : null, lastName: typeof value.lastName === "string" ? value.lastName : null };
};

const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
export const axisCareServiceTargets = serviceTypeOptions.map(option => ({ value: option.value, label: option.label }));
const allowedServiceTargets = new Set<string>(axisCareServiceTargets.map(option => option.value));

export async function getAxisCareAdministration(user: Pick<User, "id">, organizationId: string) {
  await authorizeIntegrationRead(user, organizationId);
  const [connection, caregivers, employees, visits, serviceMappings, syncStates] = await Promise.all([
    getAxisCareConnectionStatus(organizationId),
    prisma.axisCareRecord.findMany({ where: { organizationId, entity: "caregiver", removedAt: null }, select: { externalId: true, payload: true }, orderBy: { externalId: "asc" }, take: 500 }),
    prisma.employee.findMany({ where: { organizationId, ...operationalEmployeeWhere, employmentStatus: { in: ["PENDING", "ACTIVE", "LEAVE"] } }, select: { id: true, firstName: true, lastName: true, employeeNumber: true, axisCareCaregiverId: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    prisma.axisCareVisit.findMany({ where: { organizationId, serviceCode: { not: null } }, select: { serviceCode: true, payload: true }, orderBy: { startAt: "desc" }, take: 5000 }),
    prisma.axisCareServiceMapping.findMany({ where: { organizationId }, select: { axisCareServiceCode: true, waldahServiceType: true }, orderBy: { axisCareServiceCode: "asc" } }),
    prisma.axisCareSyncState.findMany({ where: { organizationId }, select: { entity: true, lastStartedAt: true, lastSuccessAt: true, lastError: true, lastCount: true }, orderBy: { entity: "asc" } }),
  ]);
  const serviceDetails = new Map<string, { axisCareServiceCode: string; axisCareServiceId: string | null; description: string | null; procedureCode: string | null; visitCount: number; waldahServiceType: string | null }>();
  for (const row of visits) {
    if (!row.serviceCode) continue;
    const existing = serviceDetails.get(row.serviceCode), service = object(object(row.payload)?.service);
    if (existing) { existing.visitCount += 1; continue; }
    serviceDetails.set(row.serviceCode, { axisCareServiceCode: row.serviceCode, axisCareServiceId: text(service?.id) ?? (typeof service?.id === "number" ? String(service.id) : null), description: text(service?.description), procedureCode: text(service?.procedureCode), visitCount: 1, waldahServiceType: serviceMappings.find(mapping => mapping.axisCareServiceCode === row.serviceCode)?.waldahServiceType ?? null });
  }
  return {
    connection,
    caregivers: caregivers.map(row => ({ externalId: row.externalId, ...identity(row.payload), employeeId: employees.find(employee => employee.axisCareCaregiverId === row.externalId)?.id ?? null })),
    employees,
    services: [...serviceDetails.values()].sort((a, b) => a.axisCareServiceCode.localeCompare(b.axisCareServiceCode)),
    serviceTargets: axisCareServiceTargets,
    syncStates: syncStates.map(row => ({ ...row, lastStartedAt: row.lastStartedAt?.toISOString() ?? null, lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null })),
    webhook: { enabled: false, reason: "AxisCare documents x-webhook-id as an identifier, not verified request authentication." },
  };
}

export async function verifyAxisCareConnection(user: Pick<User, "id">, organizationId: string) {
  await authorize(user, organizationId, "organization.manage");
  const config = await loadAxisCareConfig(organizationId);
  if (!config) throw new ResourceNotFoundError("AxisCare connection is not configured");
  return recordAxisCareConnectionTest(organizationId, user.id, await testConnection(config));
}

export async function synchronizeAxisCare(user: Pick<User, "id">, organizationId: string) {
  await authorize(user, organizationId, "billing.sync.manage");
  const connection = await prisma.axisCareConnection.findUnique({ where: { organizationId }, select: { status: true } });
  if (connection?.status !== "CONNECTED") throw new ConflictError("Verify the AxisCare connection before synchronization", "AXISCARE_CONNECTION_NOT_VERIFIED");
  const config = await loadAxisCareConfig(organizationId);
  if (!config) throw new ResourceNotFoundError("AxisCare connection is not configured");
  const result = await runFullSync(config);
  await prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "axiscare.sync_requested", entityType: "Organization", entityId: organizationId, metadataJson: { counts: result.counts, failures: result.failures, links: result.links } } });
  return result;
}

export async function mapAxisCareCaregiver(user: Pick<User, "id">, organizationId: string, externalId: string, employeeId: string) {
  await authorize(user, organizationId, "billing.mapping.manage");
  const [record, employee, alreadyMapped] = await Promise.all([
    prisma.axisCareRecord.findUnique({ where: { organizationId_entity_externalId: { organizationId, entity: "caregiver", externalId } }, select: { id: true } }),
    prisma.employee.findFirst({ where: { id: employeeId, organizationId, ...operationalEmployeeWhere }, select: { id: true, axisCareCaregiverId: true } }),
    prisma.employee.findFirst({ where: { organizationId, axisCareCaregiverId: externalId }, select: { id: true } }),
  ]);
  if (!record || !employee) throw new ResourceNotFoundError("AxisCare caregiver or employee not found");
  if (alreadyMapped && alreadyMapped.id !== employeeId) throw new ConflictError("AxisCare caregiver is already mapped", "AXISCARE_CAREGIVER_ALREADY_MAPPED");
  if (employee.axisCareCaregiverId && employee.axisCareCaregiverId !== externalId) throw new ConflictError("Employee is already mapped to another AxisCare caregiver", "EMPLOYEE_ALREADY_MAPPED");
  await prisma.$transaction([
    prisma.employee.update({ where: { id: employeeId }, data: { axisCareCaregiverId: externalId } }),
    prisma.axisCareVisit.updateMany({ where: { organizationId, axisCareCaregiverId: externalId }, data: { employeeId } }),
    prisma.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "axiscare.caregiver_mapped", entityType: "Employee", entityId: employeeId, metadataJson: { axisCareCaregiverId: externalId } } }),
  ]);
  return { externalId, employeeId };
}

export async function mapAxisCareService(user: Pick<User, "id">, organizationId: string, axisCareServiceCode: string, waldahServiceType: string) {
  await authorize(user, organizationId, "billing.mapping.manage");
  if (!allowedServiceTargets.has(waldahServiceType)) throw new ValidationError("Select an approved Waldah service type");
  const exists = await prisma.axisCareVisit.findFirst({ where: { organizationId, serviceCode: axisCareServiceCode }, select: { id: true } });
  if (!exists) throw new ResourceNotFoundError("AxisCare service code not found");
  const mapping = await prisma.$transaction(async tx => {
    const previous = await tx.axisCareServiceMapping.findUnique({ where: { organizationId_axisCareServiceCode: { organizationId, axisCareServiceCode } }, select: { waldahServiceType: true } });
    const row = await tx.axisCareServiceMapping.upsert({ where: { organizationId_axisCareServiceCode: { organizationId, axisCareServiceCode } }, create: { organizationId, axisCareServiceCode, waldahServiceType, createdByUserId: user.id, updatedByUserId: user.id }, update: { waldahServiceType, updatedByUserId: user.id } });
    await tx.auditEvent.create({ data: { organizationId, actorUserId: user.id, eventType: "axiscare.service_mapped", entityType: "AxisCareServiceMapping", entityId: row.id, metadataJson: { axisCareServiceCode, previousWaldahServiceType: previous?.waldahServiceType ?? null, waldahServiceType } } });
    return row;
  });
  return { axisCareServiceCode: mapping.axisCareServiceCode, waldahServiceType: mapping.waldahServiceType };
}
