import { z } from "zod";
import { inspectOrganizationInvitation } from "@/domain/organization-users/service";
import { inspectEmployeePortalInvitation, type PortalInvitationInspection } from "@/domain/portal/service";

export const publicInvitationToken = z.string().min(32).max(256);

export async function inspectPublicInvitation(token: string): Promise<PortalInvitationInspection> {
  if (!publicInvitationToken.safeParse(token).success) return { state: "INVALID" };
  const employee = await inspectEmployeePortalInvitation(token);
  return employee.state === "INVALID" ? inspectOrganizationInvitation(token) : employee;
}
