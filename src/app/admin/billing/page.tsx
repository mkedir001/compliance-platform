import {headers} from "next/headers";
import {PortalShell} from "@/app/components/portal-ui";
import {requireAuthenticatedUser} from "@/domain/auth/authentication";
import {requireOrganizationAccess,requirePermission} from "@/domain/permissions/authorization";
import {resolveAdminOrganizationId} from "../organization-context";

export default async function BillingPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){
 const organizationId=await resolveAdminOrganizationId((await searchParams).organizationId??""),incoming=await headers(),request=new Request(process.env.APP_BASE_URL??"http://localhost",{headers:Object.fromEntries(incoming.entries())}),user=await requireAuthenticatedUser(request),{membership}=await requireOrganizationAccess(user,organizationId);
 await requirePermission(membership.id,"organization.manage");
 return <PortalShell organizationId={organizationId} current="Billing"><main className="admin-shell" aria-label="Organization billing workspace"/></PortalShell>;
}
