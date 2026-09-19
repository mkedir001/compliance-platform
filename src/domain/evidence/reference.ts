import { z } from "zod";
export const evidenceReferenceSchema = z.string().trim().min(1).max(1000).refine(value => /^(secure:|https:\/\/|s3:\/\/|gs:\/\/|azure:\/\/)[^\s]+$/i.test(value), "Evidence must use an approved opaque or durable storage reference");
