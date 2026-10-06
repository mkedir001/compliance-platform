import { prisma } from "@/lib/prisma";
import { resolveAuthenticatedLanding } from "./landing";

export const DEVELOPMENT_VISUAL_QA_OWNER_EMAIL = "alex.owner@example.test";
export const DEVELOPMENT_VISUAL_QA_ORGANIZATION_SLUG = "northstar-support-services";

export async function resolveDevelopmentVisualQaLanding(userId: string) {
  if(process.env.NODE_ENV==="production") return null;
  const organization=await prisma.organization.findUnique({where:{slug:DEVELOPMENT_VISUAL_QA_ORGANIZATION_SLUG},select:{id:true}});
  if(!organization) return null;
  return (await resolveAuthenticatedLanding(userId)).find(destination=>destination.organizationId===organization.id&&destination.experience==="admin")??null;
}
