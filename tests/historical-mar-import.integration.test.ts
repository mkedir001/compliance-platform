import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { attestHistoricalMarEntries, previewHistoricalMarImport, reviewHistoricalMarEntry, stageHistoricalMarImport } from "@/domain/clients/historical-mar-import";
import { getAssignedClientCareViews } from "@/domain/portal/service";

const db = new PrismaClient();

describe.sequential("Radiant-only historical MAR staging and caregiver attestation", () => {
  let organizationId = "", otherOrganizationId = "", clientId = "", medicationId = "", clinicianId = "", caregiverId = "", otherCaregiverId = "", employeeId = "", batchId = "", entryId = "";
  const priorAllowlist = process.env.HISTORICAL_MAR_ORGANIZATION_IDS;

  beforeAll(async () => {
    const tag = `historical-mar-${Date.now()}`;
    const [organization, otherOrganization, clinician, caregiver, otherCaregiver] = await Promise.all([
      db.organization.create({ data: { legalName: `${tag} Radiant fixture`, displayName: `${tag} Radiant fixture`, slug: `${tag}-radiant`, timezone: "America/Chicago" } }),
      db.organization.create({ data: { legalName: `${tag} other`, displayName: `${tag} other`, slug: `${tag}-other` } }),
      db.user.create({ data: { email: `${tag}-rn@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-caregiver@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-other-caregiver@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id; otherOrganizationId = otherOrganization.id; clinicianId = clinician.id; caregiverId = caregiver.id; otherCaregiverId = otherCaregiver.id;
    process.env.HISTORICAL_MAR_ORGANIZATION_IDS = organizationId;
    const [medicationApprove, assignedRead, clientAssignedRead, clientCaregiverRead] = await Promise.all([db.permission.upsert({ where: { code: "medication.approve" }, update: {}, create: { code: "medication.approve", description: "Synthetic historical MAR fixture" } }), db.permission.upsert({ where: { code: "medication.assigned.read" }, update: {}, create: { code: "medication.assigned.read", description: "Synthetic historical MAR caregiver fixture" } }), db.permission.upsert({ where: { code: "client.assigned.read" }, update: {}, create: { code: "client.assigned.read" } }), db.permission.upsert({ where: { code: "client.caregiver.read" }, update: {}, create: { code: "client.caregiver.read" } })]);
    const clinicalRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-CLINICAL`, name: "Synthetic clinical reviewer", scope: "ORGANIZATION", permissions: { create: { permissionId: medicationApprove.id } } } });
    const caregiverRole = await db.roleDefinition.create({ data: { organizationId, code: `${tag}-CAREGIVER`, name: "Synthetic caregiver", scope: "ORGANIZATION", permissions: { create: [assignedRead, clientAssignedRead, clientCaregiverRead].map(permission => ({ permissionId: permission.id })) } } });
    const [clinicalMembership, caregiverMembership, otherCaregiverMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: clinicianId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: caregiverId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: otherCaregiverId, status: "ACTIVE" } }),
    ]);
    await db.membershipRole.createMany({ data: [{ membershipId: clinicalMembership.id, roleDefinitionId: clinicalRole.id }, { membershipId: caregiverMembership.id, roleDefinitionId: caregiverRole.id }, { membershipId: otherCaregiverMembership.id, roleDefinitionId: caregiverRole.id }] });
    await db.professionalCredential.create({ data: { organizationId, userId: clinicianId, credentialType: "RN", credentialName: "Synthetic RN", licenseNumber: `${tag}-RN`, jurisdiction: "MN", verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedByUserId: clinicianId, status: "ACTIVE" } });
    const [employee, otherEmployee] = await Promise.all([
      db.employee.create({ data: { organizationId, userId: caregiverId, firstName: "Synthetic", lastName: "Caregiver", employmentStatus: "ACTIVE", axisCareCaregiverId: `${tag}-axis-caregiver` } }),
      db.employee.create({ data: { organizationId, userId: otherCaregiverId, firstName: "Other", lastName: "Caregiver", employmentStatus: "ACTIVE", axisCareCaregiverId: `${tag}-axis-other` } }),
    ]);
    employeeId = employee.id;
    const client = await db.client.create({ data: { organizationId, legalFirstName: "Synthetic", legalLastName: "Client", createdByUserId: clinicianId, axisCareClientId: `${tag}-axis-client` } }); clientId = client.id;
    const medication = await db.clientMedication.create({ data: { organizationId, clientId, medication: "Synthetic medication", dose: "1 unit", route: "oral", times: "8 AM", startDate: new Date("2026-01-01T00:00:00Z"), stopDate: new Date("2026-01-31T00:00:00Z"), marApprovedAt: new Date("2026-01-01T00:00:00Z"), marApprovedByUserId: clinicianId } }); medicationId = medication.id;
    await db.axisCareVisit.create({ data: { organizationId, externalId: `${tag}-visit`, axisCareClientId: client.axisCareClientId, axisCareCaregiverId: employee.axisCareCaregiverId, clientId, employeeId, startAt: new Date("2026-01-15T13:00:00Z"), endAt: new Date("2026-01-15T21:00:00Z"), scheduledStartAt: new Date("2026-01-15T13:00:00Z"), scheduledEndAt: new Date("2026-01-15T21:00:00Z"), clockInAt: new Date("2026-01-15T13:00:00Z"), clockOutAt: new Date("2026-01-15T21:00:00Z"), timezone: "America/Chicago", payload: {}, payloadHash: `${tag}-visit` } });
    await db.medicationStaffSignature.create({ data: { organizationId, userId: caregiverId, typedName: "Synthetic Caregiver", initials: "SC", consentVersion: "mar-typed-signature-v1", consentedAt: new Date() } });
    expect(otherEmployee.id).not.toBe(employeeId);
  });

  afterAll(async () => {
    if (priorAllowlist === undefined) delete process.env.HISTORICAL_MAR_ORGANIZATION_IDS; else process.env.HISTORICAL_MAR_ORGANIZATION_IDS = priorAllowlist;
    await db.$disconnect();
  });

  it("fails closed outside the stable organization allowlist and requires clinical governance", async () => {
    await expect(previewHistoricalMarImport({ id: clinicianId }, otherOrganizationId, clientId, "2026-01-15", "2026-01-15")).rejects.toThrow(/not enabled/);
    await expect(previewHistoricalMarImport({ id: caregiverId }, organizationId, clientId, "2026-01-15", "2026-01-15")).rejects.toThrow(/medication.approve/);
  });

  it("previews without writes, stages idempotently, and preserves source evidence", async () => {
    const before = await db.historicalMarImportBatch.count({ where: { organizationId } });
    const preview = await previewHistoricalMarImport({ id: clinicianId }, organizationId, clientId, "2026-01-15", "2026-01-15");
    expect(preview).toMatchObject({ total: 1, readyForCaregiverReview: 1, blocked: 0, counts: { MATCHED: 1 } });
    expect(await db.historicalMarImportBatch.count({ where: { organizationId } })).toBe(before);
    const first = await stageHistoricalMarImport({ id: clinicianId }, organizationId, clientId, "2026-01-15", "2026-01-15", preview.fingerprint, { refreshSource: false });
    const second = await stageHistoricalMarImport({ id: clinicianId }, organizationId, clientId, "2026-01-15", "2026-01-15", preview.fingerprint, { refreshSource: false });
    expect(first.created).toBe(true); expect(second).toMatchObject({ id: first.id, created: false }); batchId = first.id;
    const entry = await db.historicalMarEntry.findFirstOrThrow({ where: { batchId } }); entryId = entry.id;
    expect(entry).toMatchObject({ medicationId, employeeId, matchState: "MATCHED", confidence: "ACTUAL_CLOCK_COVERAGE", paperStatus: null, finalizedDoseId: null });
    expect(JSON.stringify(entry.sourceSnapshotJson)).toContain("historical-mar-v1");
    expect(await db.serviceAssignment.count({ where: { organizationId, employeeId } })).toBe(0);
    expect((await getAssignedClientCareViews({ id: caregiverId }, organizationId)).map(client => client.id)).toContain(clientId);
    const visit = await db.axisCareVisit.findUniqueOrThrow({ where: { id: entry.axisCareVisitId! }, select: { id: true, clockOutAt: true } });
    await db.axisCareVisit.update({ where: { id: visit.id }, data: { clockOutAt: null } });
    try {
      await expect(stageHistoricalMarImport({ id: clinicianId }, organizationId, clientId, "2026-01-15", "2026-01-15", preview.fingerprint, { refreshSource: false })).rejects.toThrow(/preview is stale/);
    } finally {
      await db.axisCareVisit.update({ where: { id: visit.id }, data: { clockOutAt: visit.clockOutAt } });
    }
  });

  it("enforces self-only review and creates one immutable exact-set signature at current time", async () => {
    await expect(reviewHistoricalMarEntry({ id: otherCaregiverId }, organizationId, clientId, { action: "REVIEW_HISTORICAL_MAR_ENTRY", entryId, expectedVersion: 1, paperStatus: "GIVEN", paperTimeGiven: "08:05" })).rejects.toThrow(/only entries attributed/);
    await reviewHistoricalMarEntry({ id: caregiverId }, organizationId, clientId, { action: "REVIEW_HISTORICAL_MAR_ENTRY", entryId, expectedVersion: 1, paperStatus: "GIVEN", paperTimeGiven: "08:05" });
    const result = await attestHistoricalMarEntries({ id: caregiverId }, organizationId, clientId, batchId, [entryId]);
    expect(result.entryCount).toBe(1);
    const [entry, dose, attestation] = await Promise.all([
      db.historicalMarEntry.findUniqueOrThrow({ where: { id: entryId } }),
      db.clientMedicationDose.findFirstOrThrow({ where: { organizationId, clientId, medicationId } }),
      db.historicalMarAttestation.findUniqueOrThrow({ where: { id: result.attestationId } }),
    ]);
    expect(entry).toMatchObject({ reviewState: "ATTESTED", finalizedDoseId: dose.id, attestationId: attestation.id });
    expect(dose).toMatchObject({ doseDate: new Date("2026-01-15T00:00:00Z"), status: "GIVEN", timeGiven: "08:05", signerUserId: caregiverId, transferredFromPaper: true });
    expect(dose.signedAt.getTime()).toBeGreaterThan(new Date("2026-01-15T00:00:00Z").getTime());
    expect(attestation.entryIdsJson).toEqual([entryId]); expect(attestation.snapshotHash).toHaveLength(64); expect(attestation.snapshotJson).toEqual(expect.arrayContaining([expect.objectContaining({ id: entryId, version: 2, status: "GIVEN" })]));
  });

  it("requires a reason and a new attestation for post-signature correction without erasing history", async () => {
    const before = await db.historicalMarEntry.findUniqueOrThrow({ where: { id: entryId } });
    await expect(reviewHistoricalMarEntry({ id: caregiverId }, organizationId, clientId, { action: "REVIEW_HISTORICAL_MAR_ENTRY", entryId, expectedVersion: before.version, paperStatus: "HELD", paperNote: "Held per the signed paper MAR" })).rejects.toThrow(/correction reason/);
    await reviewHistoricalMarEntry({ id: caregiverId }, organizationId, clientId, { action: "REVIEW_HISTORICAL_MAR_ENTRY", entryId, expectedVersion: before.version, paperStatus: "HELD", paperNote: "Held per the signed paper MAR", correctionReason: "Correcting transcription after paper review" });
    await attestHistoricalMarEntries({ id: caregiverId }, organizationId, clientId, batchId, [entryId]);
    expect(await db.historicalMarAttestation.count({ where: { organizationId, batchId } })).toBe(2);
    expect(await db.clientMedicationDose.count({ where: { organizationId, medicationId, doseDate: new Date("2026-01-15T00:00:00Z"), scheduledTime: "08:00" } })).toBe(1);
    expect(await db.clientMedicationHistory.count({ where: { organizationId, entityId: (await db.historicalMarEntry.findUniqueOrThrow({ where: { id: entryId } })).finalizedDoseId!, action: "HISTORICAL_CORRECTED_AND_REATTESTED" } })).toBe(1);
  });

  it("preserves tenant and client isolation", async () => {
    await expect(reviewHistoricalMarEntry({ id: caregiverId }, otherOrganizationId, clientId, { action: "REVIEW_HISTORICAL_MAR_ENTRY", entryId, expectedVersion: 3, paperStatus: "GIVEN", paperTimeGiven: "08:05" })).rejects.toThrow();
    expect(await db.clientMedicationDose.count({ where: { organizationId: otherOrganizationId } })).toBe(0);
  });
});
