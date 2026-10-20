import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AxisCareClient } from "@/domain/axiscare/client";
import { getAxisCareAdministration, mapAxisCareCaregiver, mapAxisCareService, synchronizeAxisCare } from "@/domain/axiscare/administration";
import { loadAxisCareConfig, recordAxisCareConnectionTest, saveAxisCareConnection } from "@/domain/axiscare/config";
import { mapClientLifecycle } from "@/domain/axiscare/mapping";
import { changeAxisCareClientDisposition, confirmClientMatch, confirmExplicitClientMatch, reconcileClientLinks, syncSimpleEntity, upsertVisit } from "@/domain/axiscare/sync";
import { getAxisCareClientMatches } from "@/domain/billing/service";
import { POST as webhookPost } from "@/app/api/webhooks/axiscare/route";

const db = new PrismaClient();

describe.sequential("AxisCare tenant integration", () => {
  let organizationId = "", otherOrganizationId = "", managerId = "", viewerId = "", employeeId = "", clientId = "";
  const priorKey = process.env.AXISCARE_CREDENTIAL_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.AXISCARE_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const tag = `axiscare-${Date.now()}`;
    const [organization, other, manager, viewer, managePermission, billingPermission] = await Promise.all([
      db.organization.create({ data: { legalName: `${tag} A`, displayName: `${tag} A`, slug: `${tag}-a` } }),
      db.organization.create({ data: { legalName: `${tag} B`, displayName: `${tag} B`, slug: `${tag}-b` } }),
      db.user.create({ data: { email: `manager-${tag}@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `viewer-${tag}@example.test`, status: "ACTIVE" } }),
      db.permission.upsert({ where: { code: "organization.manage" }, update: {}, create: { code: "organization.manage" } }),
      db.permission.upsert({ where: { code: "billing.run" }, update: {}, create: { code: "billing.run" } }),
    ]);
    organizationId = organization.id; otherOrganizationId = other.id; managerId = manager.id; viewerId = viewer.id;
    const role = await db.roleDefinition.create({ data: { organizationId, code: `AXISCARE_MANAGER_${tag}`, name: "AxisCare manager", scope: "ORGANIZATION" } });
    const [managerMembership] = await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: managerId, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: viewerId, status: "ACTIVE" } }),
    ]);
    await db.rolePermission.createMany({ data: [
      { roleDefinitionId: role.id, permissionId: managePermission.id },
      { roleDefinitionId: role.id, permissionId: billingPermission.id },
    ] });
    await db.membershipRole.create({ data: { membershipId: managerMembership.id, roleDefinitionId: role.id } });
    const employee = await db.employee.create({ data: { organizationId, firstName: "Care", lastName: "Giver", employmentStatus: "ACTIVE" } });
    employeeId = employee.id;
    const client = await db.client.create({ data: { organizationId, legalFirstName: "Mapped", legalLastName: "Client", createdByUserId: managerId, axisCareClientId: "already-linked" } });
    clientId = client.id;
    await db.axisCareRecord.create({ data: { organizationId, entity: "caregiver", externalId: "caregiver-1", payload: { id: "caregiver-1", firstName: "External", lastName: "Caregiver" }, payloadHash: "h" } });
    await db.axisCareVisit.create({ data: { organizationId, externalId: "visit-1", axisCareCaregiverId: "caregiver-1", serviceCode: "HOMEMAKING", payload: { service: { id: 17, code: "HOMEMAKING", description: "Homemaking service", procedureCode: "S5130" } }, payloadHash: "h" } });
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
    expect((await db.auditEvent.findFirstOrThrow({where:{organizationId,eventType:"axiscare.service_mapped"},orderBy:{occurredAt:"desc"}})).metadataJson).toMatchObject({axisCareServiceCode:"HOMEMAKING",previousWaldahServiceType:null,waldahServiceType:"IHS_WITH_TRAINING"});
    await expect(mapAxisCareService({ id: managerId }, organizationId, "HOMEMAKING", "free text service")).rejects.toThrow(/approved Waldah service type/);
    const overview=await getAxisCareAdministration({id:managerId},organizationId);expect(overview.services.find(service=>service.axisCareServiceCode==="HOMEMAKING")).toMatchObject({axisCareServiceId:"17",description:"Homemaking service",procedureCode:"S5130",waldahServiceType:"IHS_WITH_TRAINING",visitCount:1});expect(overview.serviceTargets.map(target=>target.value)).toContain("HOMEMAKING");
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

  it("preserves authoritative AxisCare lifecycle labels without inventing statuses", () => {
    expect(mapClientLifecycle({ status: { active: true, label: "Current" } })).toEqual({ lifecycle: "ACTIVE", sourceLabel: "Current", active: true });
    expect(mapClientLifecycle({ status: { active: false, label: "On hold" } })).toEqual({ lifecycle: "INACTIVE", sourceLabel: "On hold", active: false });
    expect(mapClientLifecycle({ status: { active: false, label: "Discharged client" } }).lifecycle).toBe("DISCHARGED");
    expect(mapClientLifecycle({ status: { active: false, label: "Archived" } }).lifecycle).toBe("ARCHIVED");
    expect(mapClientLifecycle({ status: "Agency-defined status" })).toEqual({ lifecycle: "UNKNOWN", sourceLabel: "Agency-defined status", active: null });
  });

  it("keeps client and caregiver discovery separate", async () => {
    const fetcher = async (request: string | URL | Request) => {
      const url = String(request);
      const clients = [{ id: "separate-client", firstName: "Source", lastName: "Client", status: { active: true, label: "Active" } }];
      const caregivers = [{ id: "separate-caregiver", firstName: "Source", lastName: "Caregiver" }];
      return new Response(JSON.stringify({ results: { [url.includes("caregivers") ? "caregivers" : "clients"]: url.includes("caregivers") ? caregivers : clients, nextPage: null }, errors: [] }), { status: 200 });
    };
    const client = new AxisCareClient({ baseUrl: "https://10461.axiscare.com", token: "tenant-a-secret-token", fetcher });
    await syncSimpleEntity(client, organizationId, "client", "/api/clients");
    await syncSimpleEntity(client, organizationId, "caregiver", "/api/caregivers");
    expect(await db.axisCareRecord.count({ where: { organizationId, entity: "client", externalId: "separate-client" } })).toBe(1);
    expect(await db.axisCareRecord.count({ where: { organizationId, entity: "client", externalId: "separate-caregiver" } })).toBe(0);
  });

  it("persists ignore and restore decisions, excludes ignored clients, and remains idempotent after rediscovery", async () => {
    const externalId = "axis-ignore";
    await db.axisCareRecord.create({ data: { organizationId, entity: "client", externalId, payload: { id: externalId, firstName: "Ignored", lastName: "Source", status: { active: true, label: "Current" } }, payloadHash: "ignore" } });
    expect(await changeAxisCareClientDisposition(organizationId, [externalId], managerId, "IGNORE")).toEqual([{ axisCareClientId: externalId, status: "IGNORED" }]);
    expect(await changeAxisCareClientDisposition(organizationId, [externalId], managerId, "IGNORE")).toEqual([{ axisCareClientId: externalId, status: "ALREADY_IGNORED" }]);
    expect((await getAxisCareClientMatches({ id: managerId }, organizationId)).find(row => row.axisCareClientId === externalId)).toMatchObject({ state: "IGNORED", axisCareLifecycle: "ACTIVE", axisCareStatusLabel: "Current" });
    expect((await reconcileClientLinks(organizationId)).suggestedClients).toBe(0);

    const response = () => new Response(JSON.stringify({ results: { clients: [{ id: externalId, firstName: "Ignored", lastName: "Source", status: { active: true, label: "Current" } }], nextPage: null }, errors: [] }), { status: 200 });
    await syncSimpleEntity(new AxisCareClient({ baseUrl: "https://10461.axiscare.com", token: "tenant-a-secret-token", fetcher: async () => response() }), organizationId, "client", "/api/clients");
    expect((await db.axisCareRecord.findUniqueOrThrow({ where: { organizationId_entity_externalId: { organizationId, entity: "client", externalId } } })).ignoredAt).toBeInstanceOf(Date);

    expect(await changeAxisCareClientDisposition(organizationId, [externalId], managerId, "RESTORE")).toEqual([{ axisCareClientId: externalId, status: "RESTORED" }]);
    expect(await changeAxisCareClientDisposition(organizationId, [externalId], managerId, "RESTORE")).toEqual([{ axisCareClientId: externalId, status: "ALREADY_ACTIVE" }]);
    expect((await getAxisCareClientMatches({ id: managerId }, organizationId)).find(row => row.axisCareClientId === externalId)?.state).toBe("UNMATCHED");
    expect(await db.auditEvent.count({ where: { organizationId, eventType: { in: ["axiscare.client_ignored", "axiscare.client_restored"] } } })).toBeGreaterThanOrEqual(2);
  });

  it("reports safe partial bulk-ignore results and does not cross tenants", async () => {
    const openId = "axis-bulk-open", linkedId = "already-linked";
    await db.axisCareRecord.create({ data: { organizationId, entity: "client", externalId: openId, payload: { id: openId }, payloadHash: "bulk" } });
    await db.axisCareRecord.create({ data: { organizationId, entity: "client", externalId: linkedId, payload: { id: linkedId }, payloadHash: "linked" } });
    expect(await changeAxisCareClientDisposition(organizationId, [openId, linkedId, "missing"], managerId, "IGNORE")).toEqual([
      { axisCareClientId: openId, status: "IGNORED" },
      { axisCareClientId: linkedId, status: "BLOCKED_CONFIRMED" },
      { axisCareClientId: "missing", status: "NOT_FOUND" },
    ]);
    expect(await changeAxisCareClientDisposition(otherOrganizationId, [openId], managerId, "IGNORE")).toEqual([{ axisCareClientId: openId, status: "NOT_FOUND" }]);
    expect((await db.auditEvent.findFirstOrThrow({ where: { organizationId, eventType: "axiscare.clients_bulk_ignored" }, orderBy: { occurredAt: "desc" } })).metadataJson).toMatchObject({ requestedCount: 3, ignoredCount: 1, failedCount: 2 });
  });

  it("does not attach ignored AxisCare clients to visits or allow confirmation", async () => {
    const externalId = "axis-ignored-visit";
    const target = await db.client.create({ data: { organizationId, legalFirstName: "Visit", legalLastName: "Target", createdByUserId: managerId, axisCareClientId: externalId } });
    await db.axisCareRecord.create({ data: { organizationId, entity: "client", externalId, payload: { id: externalId }, payloadHash: "visit-ignore", ignoredAt: new Date(), ignoredByUserId: managerId } });
    expect(await upsertVisit(organizationId, { id: "ignored-visit", client: { id: externalId }, startDate: "2026-10-20T10:00:00Z", endDate: "2026-10-20T11:00:00Z" })).toBe(true);
    expect(await db.axisCareVisit.findUniqueOrThrow({ where: { organizationId_externalId: { organizationId, externalId: "ignored-visit" } } })).toMatchObject({ clientId: null });
    expect(await confirmExplicitClientMatch(organizationId, externalId, target.id, managerId)).toBeNull();
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
    expect((await reconcileClientLinks(organizationId)).suggestedClients).toBeGreaterThanOrEqual(1);
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

  it("allows explicit review of an unmatched source client without changing canonical fields",async()=>{const target=await db.client.create({data:{organizationId,legalFirstName:"Manual",legalLastName:"Selection",createdByUserId:managerId}});await db.axisCareRecord.create({data:{organizationId,entity:"client",externalId:"axis-no-heuristic",payload:{id:"axis-no-heuristic",firstName:"Different",lastName:"Identity"},payloadHash:"manual"}});expect(await confirmExplicitClientMatch(otherOrganizationId,"axis-no-heuristic",target.id,managerId)).toBeNull();expect(await confirmExplicitClientMatch(organizationId,"axis-no-heuristic",target.id,managerId)).toBe(target.id);expect(await db.client.findUniqueOrThrow({where:{id:target.id}})).toMatchObject({axisCareClientId:"axis-no-heuristic",legalFirstName:"Manual",legalLastName:"Selection"});expect(await db.auditEvent.count({where:{organizationId,entityId:target.id,eventType:"axiscare.client_mapped"}})).toBe(1)});

  it("keeps the public webhook fail-closed because the documented header is not request authentication", async () => {
    const response = await webhookPost(new Request("http://localhost/api/webhooks/axiscare", { method: "POST", headers: { "x-webhook-id": "documented-identifier" }, body: JSON.stringify({ event: "client.updated" }) }));
    expect(response.status).toBe(503);
  });
});
