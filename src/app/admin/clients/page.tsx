import ClientsPortal from "./clients-portal";
export default async function ClientsPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const{organizationId=""}=await searchParams;return <ClientsPortal initialOrganizationId={organizationId} productionIdentity={process.env.NODE_ENV==="production"}/>}
