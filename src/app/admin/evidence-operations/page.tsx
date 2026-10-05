import EvidenceOperations from "./evidence-operations";
import {PortalShell} from "@/app/components/portal-ui";
export default async function Page({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const{organizationId=""}=await searchParams;return <PortalShell organizationId={organizationId} current="Evidence review"><EvidenceOperations/></PortalShell>}
