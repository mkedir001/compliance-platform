import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AxisCareClient } from "@/domain/axiscare/client";
import { getAxisCareAdministration, mapAxisCareCaregiver, mapAxisCareService, synchronizeAxisCare } from "@/domain/axiscare/administration";
import { loadAxisCareConfig, recordAxisCareConnectionTest, saveAxisCareConnection } from "@/domain/axiscare/config";
import { confirmClientMatch, reconcileClientLinks, syncSimpleEntity } from "@/domain/axiscare/sync";
import { POST as webhookPost } from "@/app/api/webhooks/axiscare/route";

const db = new PrismaClient();

describe.sequential("AxisCare tenant integration", () => {
  let organizationId = "", otherOrganizationId = "", managerId = "", viewerId = "", employeeId = "", clientId = "";
  const priorKey = process.env.AXISCARE_CREDENTIAL_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.AXISCARE_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const tag = `axiscare-${Date.now()}`;
    const [organization, other, manager, viewer, permission] = await Promise.all([
      db.organization.create({ data: { legalName: `${tag} A`, displayName: `${tag} A`, slug: `${tag}-a` } }),
      db.organization.create({ data: { legalName: `${tag} B`, displayName: `${tag} B`, slug: `${tag}-b` } }),
      db.user.create({ data: { email: `manager-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `viewer-${tag}@example.test`, status: "ACTIVE" } }),
      db.permission.upsert({ where: { code: "organization.manage" }, update: {}, create: { code: "organization.manage" } }),
    ]);
    organizationId = organization.id; otherOrganizationId = other.id; managerId = manager.id; viewerId = viewer.id;
    const role = await db.roleDefinition.create({ data: { organizationId, code: `AXISCARE_MANAGER_${tag}`, name: "AxisCare manager", scope: "ORGANIZATION" } });
    const [managerMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: managerId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: viewerId, status: "ACTIVE" } }),
    ]);
    await db.rolePermission.create({ data: { roleDefinitionId: role.id, permissionId: permission.id } });
    await db.membershipRole.create({ data: { membershipId: managerMembership.id, roleDefinitionId: role.id } });
    const employee = await db.employee.create({ data: { organizationId, firstName: "Care", lastName: "Giver", employmentStatus: "ACTIVE" } });
    employeeId = employee.id;
    const client = await db.client.create({ data: { organizationId, legalFirstName: "Mapped", legalLastName: "Client", createdByUserId: managerId, axisCareClientId: "already-linked" } });
    clientId = client.id;
    await db.axisCareRecord.create({ data: { organizationId, entity: "caregiver", externalId: "caregiver-1", payload: { id: "caregiver-1", firstName: "External", lastName: "Caregiver" }, payloadHash: "h" } });
    await db.axisCareVisit.create({ data: { organizationId, externalId: "visit-1", axisCareCaregiverId: "caregiver-1", serviceCode: "HOMEMAKING", payload: {}, payloadHash: "h" } });
  });

  afterAll(() => { if (priorKey === undefined) delete process.env.AXISCARE_CREDENTIAL_ENCRYPTION_KEY; else process.env.AXISCARE_CREDENTIAL_ENCRYPTION_KEY = priorKey; });

  it("stores separate organization credentials only as ciphertext", async () => {
    await saveAxisCareConnection(organizationId, managerId, { baseUrl: "https://10461.axiscare.com", apiToken: "tenant-a-secret-token", historyMonths: 12 });
    await saveAxisCareConnection(otherOrganizationId, managerId, { baseUrl: "https://22222.axiscare.com", apiToken: "tenant-b-secret-token", historyMonths: 6 });
    const rows = await db.axisCareConnection.findMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    expect(rows).toHaveLength(2);
    expect(rows.every(row => !row.encryptedApiToken.includes("secret-token"))).toBe(true);
    expect((await loadAxisCareConfig(organizationId))?.AXISCARE_API_TOKEN).toBe("tenant-a-secret-token");
    expect((await loadAxisCareConfig(otherOrganizationId))?.AXISCARE_API_TOKEN).toBe("tenant-b-secret-token");
    const before = await db.axisCareConnection.findUniqueOrThrow({ where: { organizationId }, select: { encryptedApiToken: true, tokenFingerprint: true } });
    const safe = await saveAxisCareConnection(organizationId, managerId, { baseUrl: "https://10461.axiscare.com", historyMonths: 12 });
    const after = await db.axisCareConnection.findUniqueOrThrow({ where: { organizationId }, select: { encryptedApiToken: true, tokenFingerprint: true } });
    expect(after).toEqual(before);
    expect(JSON.stringify(safe)).not.toContain("tenant-a-secret-token");
  });

  it("exposes configuration without credentials and enforces management permission and tenant access", async () => {
    const overview = await getAxisCareAdministration({ id: managerId }, organizationId);
    expect(overview.connection).toMatchObject({ configured: true, baseUrl: "https://10461.axiscare.com", status: "CONFIGURATION_INCOMPLETE" });
    expect(JSON.stringify(overview)).not.toContain("tenant-a-secret-token");
    await expect(getAxisCareAdministration({ id: viewerId }, organizationId)).rejects.toThrow(/organization.manage/);
    await expect(getAxisCareAdministration({ id: managerId }, otherOrganizationId)).rejects.toThrow(/Organization access denied/);
  });

  it("refuses synchronization until a real connection test succeeds", async () => {
    await expect(synchronizeAxisCare({ id: managerId }, organizationId)).rejects.toMatchObject({ code: "AXISCARE_CONNECTION_NOT_VERIFIED" });
  });

  it("records genuine connection outcomes without exposing provider details", async () => {
    expect(await recordAxisCareConnectionTest(organizationId, managerId, { ok: false, status: 403 })).toMatchObject({ status: "AUTHENTICATION_FAILED", lastErrorCode: "AUTHENTICATION_FAILED" });
    expect(await recordAxisCareConnectionTest(organizationId, managerId, { ok: true })).toMatchObject({ status: "CONNECTED", lastErrorCode: null });
    expect(await db.axisCareConnection.findUniqueOrThrow({ where: { organizationId }, select: { status: true, lastTestedAt: true, lastConnectedAt: true, lastErrorCode: true } })).toMatchObject({ status: "CONNECTED", lastErrorCode: null, lastTestedAt: expect.any(Date), lastConnectedAt: expect.any(Date) });
  });

  it("maps caregivers and services explicitly and tenant-safely", async () => {
    await expect(mapAxisCareCaregiver({ id: managerId }, otherOrganizationId, "caregiver-1", employeeId)).rejects.toThrow(/Organization access denied/);
    expect(await mapAxisCareCaregiver({ id: managerId }, organizationId, "caregiver-1", employeeId)).toEqual({ externalId: "caregiver-1", employeeId });
    expect(await db.axisCareVisit.findUnique({ where: { organizationId_externalId: { organizationId, externalId: "visit-1" } } })).toMatchObject({ employeeId });
    expect(await mapAxisCareService({ id: managerId }, organizationId, "HOMEMAKING", "IHS_WITH_TRAINING")).toEqual({ axisCareServiceCode: "HOMEMAKING", waldahServiceType: "IHS_WITH_TRAINING" });
  });

  it("syncs pages idempotently and keeps only minimum-necessary fields", async () => {
    const response = () => new Response(JSON.stringify({ results: { caregivers: [{ id: 77, firstName: "Api", lastName: "Person", ssn: "never-store", email: "private@example.test" }], nextPage: null }, errors: [] }), { status: 200 });
    const client = new AxisCareClient({ baseUrl: "https://10461.axiscare.com", token: "tenant-a-secret-token", fetcher: async () => response() });
    await syncSimpleEntity(client, organizationId, "caregiver", "/api/caregivers");
    await syncSimpleEntity(client, organizationId, "caregiver", "/api/caregivers");
    const rows = await db.axisCareRecord.findMany({ where: { organizationId, entity: "caregiver", externalId: "77" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ id: 77, firstName: "Api", lastName: "Person" });
  });

  it("does not overwrite an existing client mapping during confirmation", async () => {
    await db.axisCareRecord.create({ data: { organizationId, entity: "client", externalId: "different-client", payload: { id: "different-client", firstName: "Mapped", lastName: "Client" }, payloadHash: "h" } });
    const match = await db.axisCareClientMatch.create({ data: { organizationId, axisCareClientId: "different-client", clientId, status: "SUGGESTED", reason: "review", score: 50 } });
    await expect(confirmClientMatch(organizationId, match.id, managerId)).rejects.toMatchObject({ code: "WALDAH_CLIENT_ALREADY_MATCHED" });
    expect((await db.client.findUniqueOrThrow({ where: { id: clientId } })).axisCareClientId).toBe("already-linked");
  });

  it("stages exact client candidates for explicit review without changing canonical fields", async () => {
    const client = await db.client.create({ data: { organizationId, legalFirstName: "Exact", legalLastName: "Candidate", dateOfBirth: new Date("1980-01-02T00:00:00Z"), createdByUserId: managerId } });
    await db.axisCareRecord.create({ data: { organizationId, entity: "client", externalId: "axis-exact", payload: { id: "axis-exact", firstName: "Exact", lastName: "Candidate", dateOfBirth: "1980-01-02", startDate: "2024-03-04" }, payloadHash: "exact" } });
    expect(await reconcileClientLinks(organizationId)).toMatchObject({ autoLinked: 0, suggested: 1 });
    const unchanged = await db.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(unchanged).toMatchObject({ axisCareClientId: null, axisCareServiceStartDate: null });
    const match = await db.axisCareClientMatch.findUniqueOrThrow({ where: { organizationId_axisCareClientId_clientId: { organizationId, axisCareClientId: "axis-exact", clientId: client.id } } });
    expect(match.status).toBe("SUGGESTED");
    expect(await confirmClientMatch(organizationId, match.id, managerId)).toBe(client.id);
    expect(await confirmClientMatch(otherOrganizationId, match.id, managerId)).toBeNull();
    const linked = await db.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(linked).toMatchObject({ axisCareClientId: "axis-exact", axisCareServiceStartDate: null });
  });

  it("prevents one AxisCare client from being linked to two Waldah clients", async () => {
    const second = await db.client.create({ data: { organizationId, legalFirstName: "Other", legalLastName: "Candidate", createdByUserId: managerId } });
    const match = await db.axisCareClientMatch.create({ data: { organizationId, axisCareClientId: "axis-exact", clientId: second.id, status: "SUGGESTED", reason: "manual review", score: 50 } });
    await expect(confirmClientMatch(organizationId, match.id, managerId)).rejects.toMatchObject({ code: "AXISCARE_CLIENT_ALREADY_MATCHED" });
    expect((await db.client.findUniqueOrThrow({ where: { id: second.id } })).axisCareClientId).toBeNull();
  });

  it("keeps the public webhook fail-closed because the documented header is not request authentication", async () => {
    const response = await webhookPost(new Request("http://localhost/api/webhooks/axiscare", { method: "POST", headers: { "x-webhook-id": "documented-identifier" }, body: JSON.stringify({ event: "client.updated" }) }));
    expect(response.status).toBe(503);
  });
});
