import { z } from "zod";
export const assignmentSchema=z.object({employeeId:z.string().cuid(),courseVersionId:z.string().cuid(),dueAt:z.iso.datetime().nullish().transform(v=>v?new Date(v):null)});
export const progressSchema=z.object({contentItemId:z.string().cuid()});
export const acknowledgmentSchema=z.object({contentItemId:z.string().cuid()});
export const assessmentSubmissionSchema=z.object({responses:z.array(z.object({questionId:z.string().cuid(),selectedOptionIds:z.array(z.string().cuid()).min(1)})).min(1)}).strict();
