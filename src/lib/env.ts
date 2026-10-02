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
  EMAIL_PROVIDER: z.preprocess(value => value === "" ? undefined : value, z.enum(["ses", "http"]).optional()),
  EMAIL_API_URL: z.preprocess(value => value === "" ? undefined : value, z.string().url().optional()),
  EMAIL_API_TOKEN: z.preprocess(value => value === "" ? undefined : value, z.string().min(20).optional()),
  EMAIL_FROM: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
  EMAIL_FROM_NAME: z.preprocess(value => value === "" ? undefined : value, z.string().trim().min(1).max(200).optional()),
  EMAIL_REPLY_TO: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
  AWS_REGION: z.preprocess(value => value === "" ? undefined : value, z.string().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/).optional()),
  SIGNING_DELIVERY_MODE: z.preprocess(value => value === "" ? undefined : value, z.enum(["email", "test"]).optional()),
}).superRefine((value, context) => {
  if (value.SIGNING_DELIVERY_MODE === "test") context.addIssue({ code: "custom", message: "Test signing delivery is disabled in production", path: ["SIGNING_DELIVERY_MODE"] });
  if (value.SIGNING_DELIVERY_MODE === "email" && !value.EMAIL_PROVIDER) context.addIssue({ code: "custom", message: "EMAIL_PROVIDER is required for production signing delivery", path: ["EMAIL_PROVIDER"] });
  if (value.EMAIL_PROVIDER && !value.EMAIL_FROM) context.addIssue({ code: "custom", message: "EMAIL_FROM is required for production email", path: ["EMAIL_FROM"] });
  if (value.EMAIL_PROVIDER === "ses" && !value.AWS_REGION) context.addIssue({ code: "custom", message: "AWS_REGION is required for SES delivery", path: ["AWS_REGION"] });
  if (value.EMAIL_PROVIDER === "http" && (!value.EMAIL_API_URL || !value.EMAIL_API_TOKEN)) context.addIssue({ code: "custom", message: "EMAIL_API_URL and EMAIL_API_TOKEN are required for HTTP email delivery", path: ["EMAIL_API_URL"] });
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
export type EmailEnvironment =
  | { provider: "ses"; region: string; from: string; fromName?: string; replyTo?: string }
  | { provider: "http"; apiUrl: string; apiToken: string; from: string; fromName?: string; replyTo?: string };
export function emailEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): EmailEnvironment | null {
  const provider = source.EMAIL_PROVIDER || (source.EMAIL_API_URL && source.EMAIL_API_TOKEN && source.EMAIL_FROM ? "http" : undefined);
  const common = { from: source.EMAIL_FROM, fromName: source.EMAIL_FROM_NAME || undefined, replyTo: source.EMAIL_REPLY_TO || undefined };
  if (provider === "ses" && source.AWS_REGION && common.from) return { provider, region: source.AWS_REGION, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  if (provider === "http" && source.EMAIL_API_URL && source.EMAIL_API_TOKEN && common.from) return { provider, apiUrl: source.EMAIL_API_URL, apiToken: source.EMAIL_API_TOKEN, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  return null;
}
