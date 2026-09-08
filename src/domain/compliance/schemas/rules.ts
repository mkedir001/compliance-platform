import { z } from "zod";

const schemaVersion = z.literal(1);
const leaf = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ALWAYS") }),
  z.object({ type: z.literal("EMPLOYEE_DUTY"), duty: z.string().min(1) }),
  z.object({ type: z.literal("EMPLOYEE_DUTY_ANY"), duties: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("EMPLOYMENT_STATUS"), statuses: z.array(z.enum(["PENDING", "ACTIVE", "LEAVE", "TERMINATED", "ARCHIVED"])).min(1) }),
  z.object({ type: z.literal("EMPLOYMENT_TYPE"), employmentTypes: z.array(z.enum(["FULL_TIME", "PART_TIME", "TEMPORARY", "CONTRACTOR", "VOLUNTEER", "OTHER"])).min(1) }),
  z.object({ type: z.literal("ORGANIZATION_LICENSE"), licenseType: z.enum(["MN_245D", "MN_144G", "MN_144A", "MN_245I", "OTHER"]) }),
]);
type ApplicabilityNode = z.infer<typeof leaf> | { all: ApplicabilityNode[] } | { any: ApplicabilityNode[] };
const node: z.ZodType<ApplicabilityNode> = z.lazy(() => z.union([
  leaf,
  z.object({ all: z.array(node).min(1) }).strict(),
  z.object({ any: z.array(node).min(1) }).strict(),
]));
export const applicabilitySchemaV1 = z.object({ schemaVersion, all: z.array(node).min(1).optional(), any: z.array(node).min(1).optional() }).strict().refine(v => Number(!!v.all) + Number(!!v.any) === 1, "Exactly one of all or any is required");
export type ApplicabilityDefinition = z.infer<typeof applicabilitySchemaV1>;

export const triggerSchemaV1 = z.discriminatedUnion("type", [
  z.object({ schemaVersion, type: z.literal("EMPLOYEE_HIRED") }),
  z.object({ schemaVersion, type: z.literal("FIRST_DIRECT_CONTACT") }),
  z.object({ schemaVersion, type: z.literal("FIRST_UNSUPERVISED_DIRECT_CONTACT") }),
  z.object({ schemaVersion, type: z.literal("DUTY_ASSIGNED"), duty: z.string().min(1) }),
  z.object({ schemaVersion, type: z.literal("ROLE_ASSIGNED"), roleCode: z.string().min(1) }),
  z.object({ schemaVersion, type: z.literal("FIXED_REQUIREMENT"), fixedAt: z.iso.datetime().optional() }),
]);
export type TriggerDefinition = z.infer<typeof triggerSchemaV1>;

export const deadlineSchemaV1 = z.discriminatedUnion("type", [
  z.object({ schemaVersion, type: z.literal("IMMEDIATE") }), z.object({ schemaVersion, type: z.literal("SAME_DAY") }),
  z.object({ schemaVersion, type: z.literal("WITHIN_CALENDAR_DAYS"), days: z.number().int().nonnegative() }),
  z.object({ schemaVersion, type: z.literal("WITHIN_HOURS"), hours: z.number().int().positive() }),
  z.object({ schemaVersion, type: z.literal("NO_FIXED_DEADLINE") }),
]);
export type DeadlineDefinition = z.infer<typeof deadlineSchemaV1>;
export const recurrenceSchemaV1 = z.object({ schemaVersion, type: z.enum(["NONE", "ANNUAL"]) }).strict();
export const legalGraceSchemaV1 = z.discriminatedUnion("type", [
  z.object({ schemaVersion, type: z.literal("NONE") }),
  z.object({ schemaVersion, type: z.literal("CALENDAR_DAYS_AFTER_NOMINAL_DUE"), days: z.number().int().positive(), effectiveFrom: z.iso.date().optional(), effectiveUntil: z.iso.date().optional(), appliesTo: z.literal("ANNUAL_ONLY").optional() }),
]);
const competencyType = z.enum(["KNOWLEDGE_TEST","OBSERVED_SKILL","SUPERVISOR_ATTESTATION","TRAINER_ATTESTATION","ORAL_COMPETENCY","EXTERNAL_CREDENTIAL","PRACTICAL_CHECKLIST"]);
export const competencySchemaV1 = z.union([z.object({ schemaVersion, type: z.literal("NONE") }), z.object({ schemaVersion, type: z.literal("REQUIRED"), requirements: z.array(competencyType).min(1) })]);
const evidenceType = z.enum(["TRAINING_COMPLETION","SUBJECT_HOURS","TRAINER_NAME","TRAINER_QUALIFICATION","OBSERVED_SKILL","POLICY_ACKNOWLEDGMENT","DOCUMENT_REVIEW","EXTERNAL_CREDENTIAL"]);
export const evidenceSchemaV1 = z.object({ schemaVersion, required: z.array(evidenceType) }).strict();

export const ruleDocumentSchemaV1 = z.object({
  applicabilityDefinition: applicabilitySchemaV1, triggerDefinition: triggerSchemaV1, deadlineDefinition: deadlineSchemaV1,
  recurrenceDefinition: recurrenceSchemaV1.nullable().optional(), competencyDefinition: competencySchemaV1.nullable().optional(),
  evidenceDefinition: evidenceSchemaV1.nullable().optional(), legalGraceDefinition: legalGraceSchemaV1.nullable().optional(),
});
