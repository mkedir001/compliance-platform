import EmployerOperationsPortal from "../operations-portal";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { developmentVisualQaUserId, requireAuthenticatedUser } from "@/domain/auth/authentication";
import { resolveDevelopmentVisualQaLanding } from "@/domain/auth/development-visual-qa";
import { resolveAdminOrganizationId } from "../organization-context";

export default async function Operations({searchParams}:{searchParams:Promise<{organizationId?:string}>}){
  const {organizationId=""}=await searchParams;
  if(process.env.NODE_ENV==="production") return <EmployerOperationsPortal initialOrganizationId={await resolveAdminOrganizationId(organizationId)} productionIdentity/>;
  const incoming=await headers(),request=new Request("http://localhost",{headers:Object.fromEntries(incoming.entries())});
  if(!developmentVisualQaUserId(request)) redirect("/dev/visual-qa");
  const user=await requireAuthenticatedUser(request),destination=await resolveDevelopmentVisualQaLanding(user.id);
  if(!destination) redirect("/dev/visual-qa?error=unauthorized");
  return <EmployerOperationsPortal initialOrganizationId={destination.organizationId} developmentVisualQaIdentity/>;
}
