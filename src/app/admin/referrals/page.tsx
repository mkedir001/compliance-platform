import { headers } from "next/headers";
import { developmentVisualQaUserId, requireAuthenticatedUser } from "@/domain/auth/authentication";
import { resolveDevelopmentVisualQaLanding } from "@/domain/auth/development-visual-qa";
import { resolveAdminOrganizationId } from "../organization-context";
import ReferralsPortal from "./referrals-portal";
export default async function ReferralsPage({searchParams}:{searchParams:Promise<{organizationId?:string}>}){const requested=(await searchParams).organizationId??"";if(process.env.NODE_ENV==="production")return <ReferralsPortal organizationId={await resolveAdminOrganizationId(requested)} productionIdentity/>;const incoming=await headers(),request=new Request("http://localhost",{headers:Object.fromEntries(incoming.entries())});if(developmentVisualQaUserId(request)){const user=await requireAuthenticatedUser(request),destination=await resolveDevelopmentVisualQaLanding(user.id);if(destination)return <ReferralsPortal organizationId={destination.organizationId} productionIdentity/>}return <ReferralsPortal organizationId={requested}/>}
