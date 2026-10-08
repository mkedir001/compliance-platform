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
  EMAIL_PROVIDER: z.preprocess(value => value === "" ? undefined : value, z.enum(["ses", "http", "paubox", "mailgun"]).optional()),
  EMAIL_API_URL: z.preprocess(value => value === "" ? undefined : value, z.string().url().optional()),
  EMAIL_API_TOKEN: z.preprocess(value => value === "" ? undefined : value, z.string().min(20).optional()),
  EMAIL_FROM: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
  EMAIL_FROM_NAME: z.preprocess(value => value === "" ? undefined : value, z.string().trim().min(1).max(200).optional()),
  EMAIL_REPLY_TO: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
  AWS_REGION: z.preprocess(value => value === "" ? undefined : value, z.string().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/).optional()),
  PAUBOX_RELAY_FUNCTION_NAME: z.preprocess(value => value === "" ? undefined : value, z.string().regex(/^[A-Za-z0-9-_]{1,64}$/).optional()),
  MAILGUN_RELAY_FUNCTION_NAME: z.preprocess(value => value === "" ? undefined : value, z.string().regex(/^[A-Za-z0-9-_]{1,64}$/).optional()),
  MAILGUN_FROM: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
  MAILGUN_FROM_NAME: z.preprocess(value => value === "" ? undefined : value, z.string().trim().min(1).max(200).optional()),
  MAILGUN_REPLY_TO: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
  MAILGUN_WEBHOOK_SIGNING_KEY: z.preprocess(value => value === "" ? undefined : value, z.string().min(32).optional()),
  WORKFORCE_EMAIL_PROVIDER: z.preprocess(value => value === "" ? undefined : value, z.enum(["ses", "http", "mailgun"]).optional()),
  WORKFORCE_EMAIL_API_URL: z.preprocess(value => value === "" ? undefined : value, z.string().url().optional()),
  WORKFORCE_EMAIL_API_TOKEN: z.preprocess(value => value === "" ? undefined : value, z.string().min(20).optional()),
  WORKFORCE_EMAIL_FROM: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
  WORKFORCE_EMAIL_FROM_NAME: z.preprocess(value => value === "" ? undefined : value, z.string().trim().min(1).max(200).optional()),
  WORKFORCE_EMAIL_REPLY_TO: z.preprocess(value => value === "" ? undefined : value, z.string().email().optional()),
  SIGNING_DELIVERY_MODE: z.preprocess(value => value === "" ? undefined : value, z.enum(["email", "test"]).optional()),
}).superRefine((value, context) => {
  if (value.SIGNING_DELIVERY_MODE === "test") context.addIssue({ code: "custom", message: "Test signing delivery is disabled in production", path: ["SIGNING_DELIVERY_MODE"] });
  if (value.SIGNING_DELIVERY_MODE === "email" && !value.EMAIL_PROVIDER) context.addIssue({ code: "custom", message: "EMAIL_PROVIDER is required for production signing delivery", path: ["EMAIL_PROVIDER"] });
  if (value.SIGNING_DELIVERY_MODE === "email" && (!value.AWS_REGION || !value.MAILGUN_RELAY_FUNCTION_NAME || !value.MAILGUN_FROM)) context.addIssue({ code: "custom", message: "AWS_REGION, MAILGUN_RELAY_FUNCTION_NAME, and MAILGUN_FROM are required for Mailgun-first signing delivery", path: ["MAILGUN_RELAY_FUNCTION_NAME"] });
  if (value.SIGNING_DELIVERY_MODE === "email" && value.MAILGUN_FROM !== "notifications@mail.waldah.com") context.addIssue({ code: "custom", message: "Signature Mailgun sender must be notifications@mail.waldah.com", path: ["MAILGUN_FROM"] });
  if (value.EMAIL_PROVIDER && !value.EMAIL_FROM) context.addIssue({ code: "custom", message: "EMAIL_FROM is required for production email", path: ["EMAIL_FROM"] });
  if (value.EMAIL_PROVIDER === "ses" && !value.AWS_REGION) context.addIssue({ code: "custom", message: "AWS_REGION is required for SES delivery", path: ["AWS_REGION"] });
  if (value.EMAIL_PROVIDER === "paubox" && !value.AWS_REGION) context.addIssue({ code: "custom", message: "AWS_REGION is required for Paubox relay invocation", path: ["AWS_REGION"] });
  if (value.EMAIL_PROVIDER === "paubox" && !value.PAUBOX_RELAY_FUNCTION_NAME) context.addIssue({ code: "custom", message: "PAUBOX_RELAY_FUNCTION_NAME is required for Paubox delivery", path: ["PAUBOX_RELAY_FUNCTION_NAME"] });
  if (value.EMAIL_PROVIDER === "paubox" && value.EMAIL_FROM !== "signatures@email.waldah.com") context.addIssue({ code: "custom", message: "Paubox sender must be signatures@email.waldah.com", path: ["EMAIL_FROM"] });
  if (value.EMAIL_PROVIDER === "mailgun" && (!value.AWS_REGION || !value.MAILGUN_RELAY_FUNCTION_NAME)) context.addIssue({ code: "custom", message: "AWS_REGION and MAILGUN_RELAY_FUNCTION_NAME are required for Mailgun relay invocation", path: ["MAILGUN_RELAY_FUNCTION_NAME"] });
  if (value.EMAIL_PROVIDER === "http" && (!value.EMAIL_API_URL || !value.EMAIL_API_TOKEN)) context.addIssue({ code: "custom", message: "EMAIL_API_URL and EMAIL_API_TOKEN are required for HTTP email delivery", path: ["EMAIL_API_URL"] });
  if (value.WORKFORCE_EMAIL_PROVIDER && !value.WORKFORCE_EMAIL_FROM) context.addIssue({ code: "custom", message: "WORKFORCE_EMAIL_FROM is required for workforce email", path: ["WORKFORCE_EMAIL_FROM"] });
  if (value.WORKFORCE_EMAIL_PROVIDER === "ses" && !value.AWS_REGION) context.addIssue({ code: "custom", message: "AWS_REGION is required for workforce SES delivery", path: ["AWS_REGION"] });
  if (value.WORKFORCE_EMAIL_PROVIDER === "mailgun" && (!value.AWS_REGION || !value.MAILGUN_RELAY_FUNCTION_NAME)) context.addIssue({ code: "custom", message: "AWS_REGION and MAILGUN_RELAY_FUNCTION_NAME are required for workforce Mailgun delivery", path: ["MAILGUN_RELAY_FUNCTION_NAME"] });
  if ((value.SIGNING_DELIVERY_MODE === "email" || value.EMAIL_PROVIDER === "mailgun" || value.WORKFORCE_EMAIL_PROVIDER === "mailgun") && !value.MAILGUN_WEBHOOK_SIGNING_KEY) context.addIssue({ code: "custom", message: "MAILGUN_WEBHOOK_SIGNING_KEY is required for Mailgun delivery reconciliation", path: ["MAILGUN_WEBHOOK_SIGNING_KEY"] });
  if (value.WORKFORCE_EMAIL_PROVIDER === "http" && (!value.WORKFORCE_EMAIL_API_URL || !value.WORKFORCE_EMAIL_API_TOKEN)) context.addIssue({ code: "custom", message: "WORKFORCE_EMAIL_API_URL and WORKFORCE_EMAIL_API_TOKEN are required for workforce HTTP email delivery", path: ["WORKFORCE_EMAIL_API_URL"] });
});

const productionAuthenticationSchema = z.discriminatedUnion("PRODUCTION_AUTH_MODE", [
  z.object({
    PRODUCTION_AUTH_MODE: z.literal("trusted-proxy-hmac"),
    AUTH_PROXY_SECRET: z.string().min(32),
    AWS_ALB_AUTH_SIGNER_ARN: z.string().optional(),
    AWS_ALB_AUTH_ISSUER: z.string().optional(),
    AWS_ALB_AUTH_CLIENT_ID: z.string().optional(),
    AWS_COGNITO_DOMAIN: z.string().optional(),
  }),
  z.object({
    PRODUCTION_AUTH_MODE: z.literal("aws-alb-cognito"),
    AUTH_PROXY_SECRET: z.string().min(32).optional(),
    AWS_ALB_AUTH_SIGNER_ARN: z.string().regex(/^arn:aws:elasticloadbalancing:[a-z0-9-]+:\d{12}:loadbalancer\/app\/[A-Za-z0-9-]+\/[a-f0-9]+$/),
    AWS_ALB_AUTH_ISSUER: z.string().url().refine(value => value.startsWith("https://"), "AWS_ALB_AUTH_ISSUER must use HTTPS"),
    AWS_ALB_AUTH_CLIENT_ID: z.string().min(1),
    AWS_COGNITO_DOMAIN: z.string().url().refine(value => value.startsWith("https://") && value.endsWith(".amazoncognito.com"), "AWS_COGNITO_DOMAIN must be an HTTPS Amazon Cognito domain"),
  }),
]);

const productionSchema = productionInfrastructureSchema.and(productionAuthenticationSchema);

export type ProductionEnvironment = z.infer<typeof productionSchema>;
export function validateProductionEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) { return productionSchema.parse(source); }
export function productionEnvironment() { if (process.env.NODE_ENV !== "production") return null; return validateProductionEnvironment(); }
export type EmailEnvironment =
  | { provider: "ses"; region: string; from: string; fromName?: string; replyTo?: string }
  | { provider: "paubox"; region: string; relayFunctionName: string; from: string; fromName?: string; replyTo?: string }
  | { provider: "mailgun"; region: string; relayFunctionName: string; from: string; fromName?: string; replyTo?: string }
  | { provider: "http"; apiUrl: string; apiToken: string; from: string; fromName?: string; replyTo?: string };
export function emailEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): EmailEnvironment | null {
  const provider = source.EMAIL_PROVIDER || (source.EMAIL_API_URL && source.EMAIL_API_TOKEN && source.EMAIL_FROM ? "http" : undefined);
  const common = { from: source.EMAIL_FROM, fromName: source.EMAIL_FROM_NAME || undefined, replyTo: source.EMAIL_REPLY_TO || undefined };
  if (provider === "ses" && source.AWS_REGION && common.from) return { provider, region: source.AWS_REGION, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  if (provider === "paubox" && source.AWS_REGION && source.PAUBOX_RELAY_FUNCTION_NAME && common.from === "signatures@email.waldah.com") return { provider, region: source.AWS_REGION, relayFunctionName: source.PAUBOX_RELAY_FUNCTION_NAME, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  if (provider === "mailgun" && source.AWS_REGION && source.MAILGUN_RELAY_FUNCTION_NAME && common.from) return { provider, region: source.AWS_REGION, relayFunctionName: source.MAILGUN_RELAY_FUNCTION_NAME, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  if (provider === "http" && source.EMAIL_API_URL && source.EMAIL_API_TOKEN && common.from) return { provider, apiUrl: source.EMAIL_API_URL, apiToken: source.EMAIL_API_TOKEN, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  return null;
}

export function workforceEmailEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): EmailEnvironment | null {
  const provider = source.WORKFORCE_EMAIL_PROVIDER;
  const common = { from: source.WORKFORCE_EMAIL_FROM, fromName: source.WORKFORCE_EMAIL_FROM_NAME || undefined, replyTo: source.WORKFORCE_EMAIL_REPLY_TO || undefined };
  if (provider === "ses" && source.AWS_REGION && common.from) return { provider, region: source.AWS_REGION, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  if (provider === "mailgun" && source.AWS_REGION && source.MAILGUN_RELAY_FUNCTION_NAME && common.from) return { provider, region: source.AWS_REGION, relayFunctionName: source.MAILGUN_RELAY_FUNCTION_NAME, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  if (provider === "http" && source.WORKFORCE_EMAIL_API_URL && source.WORKFORCE_EMAIL_API_TOKEN && common.from) return { provider, apiUrl: source.WORKFORCE_EMAIL_API_URL, apiToken: source.WORKFORCE_EMAIL_API_TOKEN, from: common.from, fromName: common.fromName, replyTo: common.replyTo };
  return null;
}
