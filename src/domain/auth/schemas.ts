import { z } from "zod";
export const membershipOperationSchema = z.object({ userId: z.string().cuid(), status: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "ENDED"]).default("INVITED") });
export const roleAssignmentSchema = z.object({ roleDefinitionId: z.string().cuid() });
