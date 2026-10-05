import AuditAccessManager from "./audit-access-manager";
import {PortalShell} from "@/app/components/portal-ui";
export default async function AuditAccessPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const{organizationId=""}=await searchParams;return <PortalShell organizationId={organizationId} current="Reports and audit"><AuditAccessManager initialOrganizationId={organizationId} productionIdentity={process.env.NODE_ENV==="production"}/></PortalShell>}
