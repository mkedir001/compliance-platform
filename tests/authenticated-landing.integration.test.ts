import { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import EmployerOperationsPortal from "@/app/admin/operations-portal";
import EmployeePortal from "@/app/learn/portal";
import { resolveAuthenticatedLanding } from "@/domain/auth/landing";

const db = new PrismaClient();
(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe.sequential("authenticated production landing", () => {
  let adminId: string, employeeId: string, unprivilegedId: string, organizationId: string, secondOrganizationId: string;

  beforeAll(async () => {
    const tag = `landing-${Date.now()}`;
    const [organization, secondOrganization, admin, employee, unprivileged] = await Promise.all([
      db.organization.create({ data: { legalName: tag, displayName: "Radiant Care", slug: tag } }),
      db.organization.create({ data: { legalName: `${tag}-second`, displayName: "Second Organization", slug: `${tag}-second` } }),
      db.user.create({ data: { email: `${tag}-admin@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-employee@example.test`, status: "ACTIVE" } }),
      db.user.create({ data: { email: `${tag}-member@example.test`, status: "ACTIVE" } }),
    ]);
    organizationId = organization.id; secondOrganizationId = secondOrganization.id;
    adminId = admin.id; employeeId = employee.id; unprivilegedId = unprivileged.id;
    const permission = await db.permission.upsert({ where: { code: "compliance.operations.read" }, update: {}, create: { code: "compliance.operations.read" } });
    const role = await db.roleDefinition.create({ data: { organizationId, code: `OWNER-${tag}`, name: "Organization owner", scope: "ORGANIZATION", permissions: { create: { permissionId: permission.id } } } });
    await Promise.all([
      db.organizationMembership.create({ data: { organizationId, userId: admin.id, status: "ACTIVE", roles: { create: { roleDefinitionId: role.id } } } }),
      db.organizationMembership.create({ data: { organizationId, userId: employee.id, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId, userId: unprivileged.id, status: "ACTIVE" } }),
      db.organizationMembership.create({ data: { organizationId: secondOrganization.id, userId: employee.id, status: "ACTIVE" } }),
      db.employee.create({ data: { organizationId, userId: employee.id, firstName: "Portal", lastName: "Employee", employmentStatus: "ACTIVE" } }),
      db.employee.create({ data: { organizationId: secondOrganization.id, userId: employee.id, firstName: "Multi", lastName: "Member", employmentStatus: "ACTIVE" } }),
    ]);
  });

  it("routes an authorized organization administrator to the organization Home experience", async () => {
    expect(await resolveAuthenticatedLanding(adminId)).toEqual([expect.objectContaining({ organizationId, experience: "admin", href: expect.stringContaining("/admin/home") })]);
  });

  it("routes an employee only to employee self-service without granting admin access", async () => {
    const destinations = await resolveAuthenticatedLanding(employeeId);
    expect(destinations).toHaveLength(2);
    expect(destinations.every(destination => destination.experience === "employee" && destination.href.startsWith("/learn"))).toBe(true);
  });

  it("fails closed for an active membership with neither admin permission nor employee linkage", async () => {
    expect(await resolveAuthenticatedLanding(unprivilegedId)).toEqual([]);
  });

  it("does not expose organizations without an active tenant membership", async () => {
    expect((await resolveAuthenticatedLanding(adminId)).some(destination => destination.organizationId === secondOrganizationId)).toBe(false);
  });

  it("removes manual identity controls from production portal rendering while retaining development tooling", () => {
    const productionAdmin = renderToStaticMarkup(React.createElement(EmployerOperationsPortal, { initialOrganizationId: organizationId, productionIdentity: true }));
    const productionEmployee = renderToStaticMarkup(React.createElement(EmployeePortal, { initialOrganizationId: organizationId, productionIdentity: true }));
    expect(`${productionAdmin}${productionEmployee}`).not.toMatch(/Authenticated (administrator|user) ID|Organization ID/);
    expect(renderToStaticMarkup(React.createElement(EmployeePortal))).toMatch(/Authenticated user ID/);
  });
});
