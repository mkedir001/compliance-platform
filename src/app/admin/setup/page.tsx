import OrganizationSetupPortal from "./setup-portal";
import {PortalShell} from "@/app/components/portal-ui";
import {resolveAdminOrganizationId} from "../organization-context";
export default async function SetupPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const requested=(await searchParams).organizationId??"",organizationId=await resolveAdminOrganizationId(requested);return <PortalShell organizationId={organizationId} current="Settings"><OrganizationSetupPortal/></PortalShell>}
