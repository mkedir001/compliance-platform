import { linkCognitoIdentity } from "../src/domain/auth/linkage";
import { validateProductionEnvironment } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";

async function main() {
  if (typeof linkCognitoIdentity !== "function" || typeof validateProductionEnvironment !== "function" || typeof prisma.$disconnect !== "function") {
    throw new Error("Cognito linkage runtime modules are unavailable");
  }
  console.log("Cognito linkage runtime modules loaded");
}

main().finally(() => prisma.$disconnect());
