import ActionCenter from "./action-center";
import {PortalShell} from "@/app/components/portal-ui";
export default async function Page({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const{organizationId=""}=await searchParams;return <PortalShell organizationId={organizationId} current="Home"><ActionCenter initialOrganizationId={organizationId} productionIdentity={process.env.NODE_ENV==="production"}/></PortalShell>}
