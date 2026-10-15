import { z } from "zod";

// Settings come from environment/secret store only. Never log or return these values.
const schema = z.object({
  AXISCARE_BASE_URL: z.string().url().refine(v => v.startsWith("https://"), "AXISCARE_BASE_URL must use HTTPS"),
  AXISCARE_API_TOKEN: z.string().min(10),
  AXISCARE_WEBHOOK_ID: z.string().min(10),
  AXISCARE_ORGANIZATION_ID: z.string().min(1),
  AXISCARE_EXTRA_ENTITIES: z.string().optional().transform(v => (v ?? "").split(",").map(x => x.trim()).filter(Boolean)),
  AXISCARE_HISTORY_MONTHS: z.coerce.number().int().min(1).max(60).default(12)
});
export type AxisCareConfig = z.infer<typeof schema>;
export function axisCareConfig(source: Record<string, string | undefined> = process.env): AxisCareConfig | null {
  const parsed = schema.safeParse(source);
  return parsed.success ? parsed.data : null;
}
