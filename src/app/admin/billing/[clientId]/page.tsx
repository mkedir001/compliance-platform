import {headers} from "next/headers";
import {notFound} from "next/navigation";
import {PortalShell} from "@/app/components/portal-ui";
import {requireAuthenticatedUser} from "@/domain/auth/authentication";
import {getBillingAccess,getBillingVisits,getBillingWorkspaceClients} from "@/domain/billing/service";
import {resolveAdminOrganizationId} from "../../organization-context";
import ClientBillingDetail from "../client-billing-detail";

export default async function BillingClientPage({params,searchParams}:{params:Promise<{clientId:string}>;searchParams:Promise<{organizationId?:string}>}){
 const {clientId}=await params,organizationId=await resolveAdminOrganizationId((await searchParams).organizationId??""),incoming=await headers(),request=new Request(process.env.APP_BASE_URL??"http://localhost",{headers:Object.fromEntries(incoming.entries())}),user=await requireAuthenticatedUser(request),access=await getBillingAccess(user,organizationId),client=(await getBillingWorkspaceClients(user,organizationId)).find(row=>row.id===clientId);
 if(!client)notFound();
 // Visits and rates are only loaded for billing.run, and only for this one client.
 const visits=access.canView&&client.axisCareLinked?await getBillingVisits(user,organizationId,new Date(),clientId):[];
 return <PortalShell organizationId={organizationId} current="Billing"><ClientBillingDetail client={client} visits={visits} canView={access.canView} canInitiate={access.canInitiate} organizationId={organizationId}/></PortalShell>;
}
