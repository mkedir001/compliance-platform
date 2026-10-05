import WorkforceOnboarding from "./workforce-onboarding";
import {PortalShell} from "@/app/components/portal-ui";
export default async function WorkforceOnboardingPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const{organizationId=""}=await searchParams;return <PortalShell organizationId={organizationId} current="Employees"><WorkforceOnboarding/></PortalShell>}
