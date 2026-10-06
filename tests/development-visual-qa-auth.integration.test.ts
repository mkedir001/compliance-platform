import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import EmployerOperationsPortal from "@/app/admin/operations-portal";
import { POST } from "@/app/dev/visual-qa/session/route";
import { developmentVisualQaUserId, requireAuthenticatedUser } from "@/domain/auth/authentication";
import { DEVELOPMENT_VISUAL_QA_OWNER_EMAIL } from "@/domain/auth/development-visual-qa";
import { resolveAuthenticatedLanding } from "@/domain/auth/landing";
import { getEmployerDashboard, getWorkforceDirectory } from "@/domain/admin/service";
import { listClients } from "@/domain/clients/service";

const db = new PrismaClient();
(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe.sequential("development visual-QA authentication", () => {
  let ownerId: string, organizationId: string, foreignOrganizationId: string;

  beforeAll(async () => {
    const owner=await db.user.findUniqueOrThrow({where:{email:DEVELOPMENT_VISUAL_QA_OWNER_EMAIL}});
    const organization=await db.organization.findUniqueOrThrow({where:{slug:"northstar-support-services"}});
    const foreign=await db.organization.findUniqueOrThrow({where:{slug:"lakeside-community-services"}});
    ownerId=owner.id; organizationId=organization.id; foreignOrganizationId=foreign.id;
  });

  afterEach(()=>vi.unstubAllEnvs());

  it("starts a development-only owner session and resolves its organization from membership", async () => {
    vi.stubEnv("NODE_ENV","test");
    const response=await POST(new Request("http://localhost:3000/dev/visual-qa/session",{method:"POST"}));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(`/admin/home?organizationId=${organizationId}`);
    const cookie=response.headers.get("set-cookie")!.split(";")[0];
    const request=new Request("http://localhost:3000/api",{headers:{cookie}});
    expect(developmentVisualQaUserId(request)).toBe(ownerId);
    expect((await requireAuthenticatedUser(request)).id).toBe(ownerId);
    expect(await resolveAuthenticatedLanding(ownerId)).toContainEqual(expect.objectContaining({organizationId,experience:"admin"}));
  });

  it("renders only the redesigned shell for the visual-QA identity", () => {
    const markup=renderToStaticMarkup(React.createElement(EmployerOperationsPortal,{initialOrganizationId:organizationId,developmentVisualQaIdentity:true}));
    expect(markup).toContain("portal-sidebar");
    expect(markup).toContain("Organization navigation");
    expect(markup).not.toMatch(/Authenticated administrator ID|Organization ID|Open operations|phase-nav/);
  });

  it("keeps the manual controls in a separate development harness", async () => {
    const [ordinary,harness]=await Promise.all([readFile("src/app/admin/compliance-operations/page.tsx","utf8"),readFile("src/app/dev/harness/compliance-operations/page.tsx","utf8")]);
    expect(ordinary).not.toContain("phase-nav");
    expect(harness).toContain("phase-nav");
    expect(renderToStaticMarkup(React.createElement(EmployerOperationsPortal))).toMatch(/Authenticated administrator ID|Organization ID|Open operations/);
  });

  it("uses the seeded owner's legitimate employee and client permissions while preserving tenant isolation", async () => {
    const user={id:ownerId};
    await expect(getEmployerDashboard(user,organizationId)).resolves.toBeTruthy();
    await expect(getWorkforceDirectory(user,organizationId)).resolves.toEqual(expect.objectContaining({items:expect.any(Array)}));
    await expect(listClients(user,organizationId)).resolves.toEqual(expect.any(Array));
    await expect(getEmployerDashboard(user,foreignOrganizationId)).rejects.toThrow(/denied/);
    await expect(listClients(user,foreignOrganizationId)).rejects.toThrow(/denied/);
  });

  it("rejects the visual-QA cookie and bootstrap endpoint in production", async () => {
    vi.stubEnv("NODE_ENV","production");
    const request=new Request("https://app.example.test",{headers:{cookie:`compliance_visual_qa_user=${ownerId}`}});
    expect(developmentVisualQaUserId(request)).toBeNull();
    const response=await POST(new Request("https://app.example.test/dev/visual-qa/session",{method:"POST"}));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
