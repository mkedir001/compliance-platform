import { z } from "zod";

const optionalText = z.string().trim().min(1).max(255).nullish().transform((v) => v || null);
export const organizationCreateSchema = z.object({
  legalName: z.string().trim().min(1).max(255), displayName: z.string().trim().min(1).max(255),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), timezone: z.string().trim().min(1).max(100).default("America/Chicago"),
  defaultLanguage: optionalText, phone: optionalText, email: z.string().trim().email().nullish().transform((v) => v || null),
  addressLine1: optionalText, addressLine2: optionalText, city: optionalText, state: optionalText, postalCode: optionalText, country: optionalText,
});
export const organizationUpdateSchema = organizationCreateSchema.partial();
export const programCreateSchema = z.object({ name: z.string().trim().min(1).max(255), code: optionalText, programType: optionalText });
export const programUpdateSchema = programCreateSchema.partial();
export const locationCreateSchema = z.object({ programId: optionalText, name: z.string().trim().min(1).max(255), locationType: optionalText, addressLine1: optionalText, addressLine2: optionalText, city: optionalText, state: optionalText, postalCode: optionalText, country: optionalText });
export const locationUpdateSchema = locationCreateSchema.partial();
