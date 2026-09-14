import type { WorkReadinessTrigger } from "@prisma/client";
import { evaluateEmployeeWorkReadiness } from "./service";

export async function reevaluateEmployeeReadinessSafely(organizationId: string, employeeId: string, trigger: WorkReadinessTrigger) {
  try {
    return await evaluateEmployeeWorkReadiness(organizationId, employeeId, trigger);
  } catch (error) {
    console.error("Workforce readiness reevaluation failed", { organizationId, employeeId, trigger, error });
    return null;
  }
}
