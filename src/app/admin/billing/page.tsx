import {headers} from "next/headers";
import {PortalShell} from "@/app/components/portal-ui";
import {requireAuthenticatedUser} from "@/domain/auth/authentication";
import {requireOrganizationAccess,requirePermission} from "@/domain/permissions/authorization";
import {prisma} from "@/lib/prisma";
import {resolveAdminOrganizationId} from "../organization-context";
import BillingPortal,{type BillingClient} from "./billing-portal";

export default async function BillingPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){
 const organizationId=await resolveAdminOrganizationId((await searchParams).organizationId??""),incoming=await headers(),request=new Request(process.env.APP_BASE_URL??"http://localhost",{headers:Object.fromEntries(incoming.entries())}),user=await requireAuthenticatedUser(request),{membership}=await requireOrganizationAccess(user,organizationId);
 await requirePermission(membership.id,"organization.manage");
 const rows=await prisma.client.findMany({where:{organizationId,archivedAt:null,testDataMarkedAt:null},select:{id:true,legalFirstName:true,legalLastName:true,preferredName:true,status:true,services:{select:{startDate:true,authorizationStart:true,authorizationEnd:true,authorizedHours:true}}},orderBy:[{legalLastName:"asc"},{legalFirstName:"asc"}]});
 const clients:BillingClient[]=rows.map(row=>({id:row.id,name:`${row.legalFirstName} ${row.legalLastName}`,status:row.status,serviceStart:row.services.map(service=>(service.authorizationStart??service.startDate)?.toISOString().slice(0,10)).filter((value):value is string=>Boolean(value)).sort()[0]??null,serviceEnd:row.services.map(service=>service.authorizationEnd?.toISOString().slice(0,10)).filter((value):value is string=>Boolean(value)).sort().at(-1)??null,approvedHours:row.services.some(service=>service.authorizedHours!==null)?row.services.reduce((sum,service)=>sum+Number(service.authorizedHours??0),0):null}));
 return <PortalShell organizationId={organizationId} current="Billing"><BillingPortal clients={clients}/></PortalShell>;
}
