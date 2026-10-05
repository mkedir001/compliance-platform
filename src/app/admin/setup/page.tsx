import OrganizationSetupPortal from "./setup-portal";
import {PortalShell} from "@/app/components/portal-ui";
export default async function SetupPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const{organizationId=""}=await searchParams;return <PortalShell organizationId={organizationId} current="Settings"><OrganizationSetupPortal/></PortalShell>}
