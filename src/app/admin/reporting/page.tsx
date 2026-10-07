import ReportingCenter from "./reporting-center";
import {PortalShell} from "@/app/components/portal-ui";
import {resolveAdminOrganizationId} from "../organization-context";
export default async function ReportingPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const requested=(await searchParams).organizationId??"",organizationId=await resolveAdminOrganizationId(requested);return <PortalShell organizationId={organizationId} current="Reports and audit"><ReportingCenter/></PortalShell>}
