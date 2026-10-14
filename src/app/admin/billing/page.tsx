import {headers} from "next/headers";
import {PortalShell} from "@/app/components/portal-ui";
import {requireAuthenticatedUser} from "@/domain/auth/authentication";
import {getBillingWorkspaceClients} from "@/domain/billing/service";
import {resolveAdminOrganizationId} from "../organization-context";
import BillingPortal from "./billing-portal";

export default async function BillingPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){
 const organizationId=await resolveAdminOrganizationId((await searchParams).organizationId??""),incoming=await headers(),request=new Request(process.env.APP_BASE_URL??"http://localhost",{headers:Object.fromEntries(incoming.entries())}),user=await requireAuthenticatedUser(request),clients=await getBillingWorkspaceClients(user,organizationId);
 return <PortalShell organizationId={organizationId} current="Billing"><BillingPortal clients={clients}/></PortalShell>;
}
