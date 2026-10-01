import ClientsPortal from "./clients-portal";
export default async function ClientsPage({searchParams}:{searchParams:Promise<{organizationId?:string;clientId?:string}>}){const{organizationId="",clientId=""}=await searchParams;return <ClientsPortal initialOrganizationId={organizationId} initialClientId={clientId} productionIdentity={process.env.NODE_ENV==="production"}/>}
