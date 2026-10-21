import {headers} from "next/headers";
import {PortalShell} from "@/app/components/portal-ui";
import {requireAuthenticatedUser} from "@/domain/auth/authentication";
import {getAxisCareClientMatches,getBillingAccess,getBillingVisits,getBillingWorkspaceClients} from "@/domain/billing/service";
import {getAxisCareConnectionStatus} from "@/domain/axiscare/config";
import {resolveAdminOrganizationId} from "../organization-context";
import BillingPortal from "./billing-portal";

export default async function BillingPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){
 const organizationId=await resolveAdminOrganizationId((await searchParams).organizationId??""),incoming=await headers(),request=new Request(process.env.APP_BASE_URL??"http://localhost",{headers:Object.fromEntries(incoming.entries())}),user=await requireAuthenticatedUser(request),access=await getBillingAccess(user,organizationId),clients=await getBillingWorkspaceClients(user,organizationId);
 // Visits, rates and match suggestions are only loaded for billing.run. View-only admins never receive them.
 const visits=access.canView?await getBillingVisits(user,organizationId):[],matches=access.canManageMapping?await getAxisCareClientMatches(user,organizationId):[],connection=await getAxisCareConnectionStatus(organizationId);
 return <PortalShell organizationId={organizationId} current="Billing"><BillingPortal clients={clients} canView={access.canView} canInitiate={access.canInitiate} canManageMapping={access.canManageMapping} canManageIntegration={access.canManageIntegration} canManageSync={access.canManageSync} visits={visits} matches={matches} organizationId={organizationId} connection={connection}/></PortalShell>;
}
