import { z } from "zod";
const nullableText = z.string().trim().max(255).nullish().transform((v) => v || null);
const nullableDate = z.iso.date().nullish().transform((v) => v ? new Date(`${v}T00:00:00.000Z`) : null);
export const employeeCreateSchema = z.object({
  employeeNumber: nullableText, firstName: z.string().trim().min(1).max(100), middleName: nullableText,
  lastName: z.string().trim().min(1).max(100), preferredName: nullableText, email: z.string().trim().email().nullish().transform((v) => v || null), phone: nullableText,
  hireDate: nullableDate, terminationDate: nullableDate, employmentStatus: z.enum(["PENDING", "ACTIVE", "LEAVE", "TERMINATED", "ARCHIVED"]).default("PENDING"),
  jobTitle: nullableText, employmentType: z.enum(["FULL_TIME", "PART_TIME", "TEMPORARY", "CONTRACTOR", "VOLUNTEER", "OTHER"]).nullish(),
}).strict();
export const employeeUpdateSchema = employeeCreateSchema.partial().extend({ userId: z.string().cuid().nullish() });
export const employeeDutyAssignmentSchema = z.object({ dutyDefinitionId: z.string().cuid(), effectiveFrom: z.iso.date().transform((v) => new Date(`${v}T00:00:00.000Z`)), effectiveUntil: nullableDate, source: nullableText }).refine((v) => !v.effectiveUntil || v.effectiveUntil >= v.effectiveFrom, { message: "effectiveUntil must not precede effectiveFrom" });
