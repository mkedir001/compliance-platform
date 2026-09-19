import { z } from "zod";
import { evidenceReferenceSchema } from "./reference";

export const assessmentCreateSchema = z.object({
  employeeId: z.string().min(1), competencyDefinitionId: z.string().min(1),
  skillChecklistVersionId: z.string().min(1).optional(), trainingAssignmentId: z.string().min(1).optional(),
  complianceInstanceId: z.string().min(1).optional(), notes: z.string().max(4000).optional(),
});
export const assessmentFinalizeSchema = z.object({items:z.array(z.object({skillChecklistItemId:z.string().min(1),result:z.enum(["PASS","FAIL","NOT_OBSERVED","NOT_APPLICABLE"]),notes:z.string().max(2000).optional()})).default([]),notes:z.string().max(4000).optional()});
export const externalTrainingSchema=z.object({employeeId:z.string().min(1),providerName:z.string().min(1),trainingName:z.string().min(1),trainingDate:z.coerce.date(),trainingMinutes:z.number().int().positive().optional(),credentialNumber:z.string().optional(),expiresAt:z.coerce.date().optional(),evidenceReference:evidenceReferenceSchema.optional(),notes:z.string().optional()});
export const equivalencySchema=z.object({externalTrainingRecordId:z.string(),requirementVersionId:z.string(),decision:z.enum(["APPROVED","DENIED","NEEDS_MORE_INFORMATION"]),competencyVerified:z.boolean().default(false),reason:z.string().min(1)});
export const attestationSchema=z.object({attestationType:z.enum(["POLICY_ACKNOWLEDGMENT","TRAINER_ATTESTATION","SUPERVISOR_COMPETENCY","EMPLOYEE_COMPLETION","DOCUMENT_REVIEW","OTHER"]),signerEmployeeId:z.string().optional(),typedName:z.string().min(1),statementVersion:z.string().min(1),statementSnapshot:z.string().min(1),resourceType:z.string().min(1),resourceId:z.string().min(1),resourceVersionId:z.string().optional(),ipAddress:z.string().optional(),userAgent:z.string().optional(),sessionReference:z.string().optional()});
export const correctionSchema=z.object({resourceType:z.string().min(1),resourceId:z.string().min(1),correctionType:z.enum(["SUPERSEDED","VOIDED","CORRECTED_BY_REPLACEMENT","ADMINISTRATIVE_NOTE"]),reason:z.string().min(1),replacementResourceType:z.string().optional(),replacementResourceId:z.string().optional()});
