import ReportingCenter from "./reporting-center";
import {PortalShell} from "@/app/components/portal-ui";
export default async function ReportingPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const{organizationId=""}=await searchParams;return <PortalShell organizationId={organizationId} current="Reports and audit"><ReportingCenter/></PortalShell>}
