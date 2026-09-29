import { z } from "zod";

const productionInfrastructureSchema = z.object({
  DATABASE_URL: z.string().url().refine(value => value.startsWith("postgresql://") || value.startsWith("postgres://"), "DATABASE_URL must use PostgreSQL"),
  APP_BASE_URL: z.string().url().refine(value => value.startsWith("https://"), "APP_BASE_URL must use HTTPS in production"),
  JOB_SECRET: z.string().min(32),
  JOB_ACTOR_USER_ID: z.string().min(1),
  RATE_LIMIT_URL: z.string().url().refine(value => value.startsWith("https://"), "RATE_LIMIT_URL must use HTTPS"),
  RATE_LIMIT_TOKEN: z.string().min(20),
  EVIDENCE_STORAGE_MODE: z.literal("external-reference"),
  EVIDENCE_STORAGE_URL: z.string().url().refine(value => value.startsWith("https://"), "EVIDENCE_STORAGE_URL must use HTTPS"),
  EVIDENCE_STORAGE_TOKEN: z.string().min(20),
  EMAIL_API_URL: z.preprocess(value => value === "" ? undefined : value, z.string().url().optional()),
  EMAIL_API_TOKEN: z.preprocess(value => value === "" ? undefined : value, z.string().min(20).optional()),
  EMAIL_FROM: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
}).superRefine((value, context) => {
  const emailValues = [value.EMAIL_API_URL, value.EMAIL_API_TOKEN, value.EMAIL_FROM].filter(Boolean).length;
  if (emailValues !== 0 && emailValues !== 3) context.addIssue({ code: "custom", message: "EMAIL_API_URL, EMAIL_API_TOKEN, and EMAIL_FROM must be configured together", path: ["EMAIL_API_URL"] });
});

const productionAuthenticationSchema = z.discriminatedUnion("PRODUCTION_AUTH_MODE", [
  z.object({
    PRODUCTION_AUTH_MODE: z.literal("trusted-proxy-hmac"),
    AUTH_PROXY_SECRET: z.string().min(32),
    AWS_ALB_AUTH_SIGNER_ARN: z.string().optional(),
    AWS_ALB_AUTH_ISSUER: z.string().optional(),
    AWS_ALB_AUTH_CLIENT_ID: z.string().optional(),
  }),
  z.object({
    PRODUCTION_AUTH_MODE: z.literal("aws-alb-cognito"),
    AUTH_PROXY_SECRET: z.string().min(32).optional(),
    AWS_ALB_AUTH_SIGNER_ARN: z.string().regex(/^arn:aws:elasticloadbalancing:[a-z0-9-]+:\d{12}:loadbalancer\/app\/[A-Za-z0-9-]+\/[a-f0-9]+$/),
    AWS_ALB_AUTH_ISSUER: z.string().url().refine(value => value.startsWith("https://"), "AWS_ALB_AUTH_ISSUER must use HTTPS"),
    AWS_ALB_AUTH_CLIENT_ID: z.string().min(1),
  }),
]);

const productionSchema = productionInfrastructureSchema.and(productionAuthenticationSchema);

export type ProductionEnvironment = z.infer<typeof productionSchema>;
export function validateProductionEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) { return productionSchema.parse(source); }
export function productionEnvironment() { if (process.env.NODE_ENV !== "production") return null; return validateProductionEnvironment(); }
export function emailEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) { const values = [source.EMAIL_API_URL, source.EMAIL_API_TOKEN, source.EMAIL_FROM]; return values.every(Boolean) ? { apiUrl: values[0]!, apiToken: values[1]!, from: values[2]! } : null; }
