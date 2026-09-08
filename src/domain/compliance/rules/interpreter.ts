import type { EmploymentStatus, EmploymentType, LicenseType } from "@prisma/client";
import { applicabilitySchemaV1, type ApplicabilityDefinition, type TriggerDefinition } from "../schemas/rules";

export type WorkforceContext = { employmentStatus: EmploymentStatus; employmentType: EmploymentType | null; licenses: Set<LicenseType>; duties: Map<string, Date>; roles: Map<string, Date>; hireDate: Date | null; events: Map<string, { id: string; occurredAt: Date }> };
type Node = ApplicabilityDefinition["all"] extends (infer N)[] | undefined ? N : never;
function evaluateNode(node: Node, ctx: WorkforceContext): boolean {
  if ("all" in node) return node.all.every(n => evaluateNode(n as Node, ctx));
  if ("any" in node) return node.any.some(n => evaluateNode(n as Node, ctx));
  switch (node.type) {
    case "ALWAYS": return true;
    case "EMPLOYEE_DUTY": return ctx.duties.has(node.duty);
    case "EMPLOYEE_DUTY_ANY": return node.duties.some(d => ctx.duties.has(d));
    case "EMPLOYMENT_STATUS": return node.statuses.includes(ctx.employmentStatus);
    case "EMPLOYMENT_TYPE": return !!ctx.employmentType && node.employmentTypes.includes(ctx.employmentType);
    case "ORGANIZATION_LICENSE": return ctx.licenses.has(node.licenseType);
  }
}
export function evaluateApplicability(input: unknown, ctx: WorkforceContext) {
  const definition = applicabilitySchemaV1.parse(input);
  return definition.all ? definition.all.every(n => evaluateNode(n as Node, ctx)) : definition.any!.some(n => evaluateNode(n as Node, ctx));
}
export type ResolvedTrigger = { resolved: true; date: Date; reference: string | null } | { resolved: false; reason: string };
export function resolveTrigger(trigger: TriggerDefinition, ctx: WorkforceContext): ResolvedTrigger {
  switch (trigger.type) {
    case "EMPLOYEE_HIRED": return ctx.hireDate ? { resolved:true,date:ctx.hireDate,reference:"Employee.hireDate" } : { resolved:false,reason:"Employee hire date is missing" };
    case "FIRST_DIRECT_CONTACT": { const e=ctx.events.get("FIRST_DIRECT_CONTACT"); return e ? {resolved:true,date:e.occurredAt,reference:e.id}:{resolved:false,reason:"FIRST_DIRECT_CONTACT event is missing"}; }
    case "FIRST_UNSUPERVISED_DIRECT_CONTACT": { const e=ctx.events.get("FIRST_UNSUPERVISED_DIRECT_CONTACT"); return e ? {resolved:true,date:e.occurredAt,reference:e.id}:{resolved:false,reason:"FIRST_UNSUPERVISED_DIRECT_CONTACT event is missing"}; }
    case "DUTY_ASSIGNED": { const date=ctx.duties.get(trigger.duty); return date ? {resolved:true,date,reference:trigger.duty}:{resolved:false,reason:`${trigger.duty} duty is missing`}; }
    case "ROLE_ASSIGNED": { const date=ctx.roles.get(trigger.roleCode); return date ? {resolved:true,date,reference:trigger.roleCode}:{resolved:false,reason:`${trigger.roleCode} role is missing`}; }
    case "FIXED_REQUIREMENT": return trigger.fixedAt ? {resolved:true,date:new Date(trigger.fixedAt),reference:trigger.fixedAt}:{resolved:false,reason:"Fixed requirement date is missing"};
  }
}
