import ClientsPortal from "./clients-portal";
import {headers} from "next/headers";
import {developmentVisualQaUserId,requireAuthenticatedUser} from "@/domain/auth/authentication";
import {resolveDevelopmentVisualQaLanding} from "@/domain/auth/development-visual-qa";
import {resolveAdminOrganizationId} from "../organization-context";

export default async function ClientsPage({searchParams}:{searchParams:Promise<{organizationId?:string;clientId?:string;documentId?:string;requestId?:string;importSessionId?:string;view?:string}>}){
 const{organizationId="",clientId="",documentId="",requestId="",importSessionId="",view=""}=await searchParams;
 if(process.env.NODE_ENV==="production")return <ClientsPortal initialOrganizationId={await resolveAdminOrganizationId(organizationId)} initialClientId={clientId} initialDocumentId={documentId} initialRequestId={requestId} initialImportSessionId={importSessionId} initialView={view} productionIdentity/>;
 const incoming=await headers(),request=new Request("http://localhost",{headers:Object.fromEntries(incoming.entries())});
 if(developmentVisualQaUserId(request)){const user=await requireAuthenticatedUser(request),destination=await resolveDevelopmentVisualQaLanding(user.id);if(destination)return <ClientsPortal initialOrganizationId={destination.organizationId} initialClientId={clientId} initialDocumentId={documentId} initialRequestId={requestId} initialImportSessionId={importSessionId} initialView={view} productionIdentity/>;}
 return <ClientsPortal initialOrganizationId={organizationId} initialClientId={clientId} initialDocumentId={documentId} initialRequestId={requestId} initialImportSessionId={importSessionId} initialView={view}/>;
}
