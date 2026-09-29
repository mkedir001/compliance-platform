import { z } from "zod";
import { linkCognitoIdentity } from "../src/domain/auth/linkage";
import { validateProductionEnvironment } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

function value(flag: string) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function main() {
  if (process.env.NODE_ENV !== "production") throw new Error("Cognito identity linkage requires NODE_ENV=production");
  const environment = validateProductionEnvironment();
  if (environment.PRODUCTION_AUTH_MODE !== "aws-alb-cognito") throw new Error("Cognito identity linkage requires PRODUCTION_AUTH_MODE=aws-alb-cognito");
  const parsed = z.object({ userId: z.string().min(1).optional(), email: z.string().email().optional(), subject: z.string().min(1).max(256) }).refine(input => Boolean(input.userId) !== Boolean(input.email), "Provide exactly one of --user-id or --email").parse({ userId: value("--user-id"), email: value("--email"), subject: value("--cognito-subject") });
  const result = await linkCognitoIdentity(parsed.userId ? { userId: parsed.userId, subject: parsed.subject } : { email: parsed.email!, subject: parsed.subject });
  console.log(JSON.stringify(result));
}

main().finally(() => prisma.$disconnect());
