import EvidenceOperations from "./evidence-operations";
import {PortalShell} from "@/app/components/portal-ui";
import {resolveAdminOrganizationId} from "../organization-context";
export default async function Page({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const requested=(await searchParams).organizationId??"",organizationId=await resolveAdminOrganizationId(requested);return <PortalShell organizationId={organizationId} current="Evidence review"><EvidenceOperations/></PortalShell>}
