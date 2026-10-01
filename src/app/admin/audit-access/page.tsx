import AuditAccessManager from "./audit-access-manager";
export default async function AuditAccessPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const{organizationId=""}=await searchParams;return <AuditAccessManager initialOrganizationId={organizationId} productionIdentity={process.env.NODE_ENV==="production"}/>}
