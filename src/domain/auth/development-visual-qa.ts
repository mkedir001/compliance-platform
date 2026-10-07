import { prisma } from "@/lib/prisma";
import { resolveAuthenticatedLanding } from "./landing";

export const DEVELOPMENT_VISUAL_QA_OWNER_EMAIL = "visual.qa.owner@example.test";
export const DEVELOPMENT_VISUAL_QA_ORGANIZATION_SLUG = "radiant-care-visual-qa";
export const DEVELOPMENT_VISUAL_QA_ORGANIZATION_NAME = "Radiant Care — Visual QA";

export function developmentVisualQaMode(environment: NodeJS.ProcessEnv = process.env) {
  return environment.NODE_ENV !== "production" && environment.VISUAL_QA_MODE === "true";
}

export async function resolveDevelopmentVisualQaLanding(userId: string) {
  if(!developmentVisualQaMode()) return null;
  const organization=await prisma.organization.findUnique({where:{slug:DEVELOPMENT_VISUAL_QA_ORGANIZATION_SLUG},select:{id:true}});
  if(!organization) return null;
  return (await resolveAuthenticatedLanding(userId)).find(destination=>destination.organizationId===organization.id&&destination.experience==="admin")??null;
}
