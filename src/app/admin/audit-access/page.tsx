import AuditAccessManager from "./audit-access-manager";
import {PortalShell} from "@/app/components/portal-ui";
import {resolveAdminOrganizationId} from "../organization-context";
export default async function AuditAccessPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const requested=(await searchParams).organizationId??"",organizationId=await resolveAdminOrganizationId(requested);return <PortalShell organizationId={organizationId} current="Reports and audit"><AuditAccessManager initialOrganizationId={organizationId} productionIdentity={process.env.NODE_ENV==="production"}/></PortalShell>}
