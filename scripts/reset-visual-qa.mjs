import { spawnSync } from "node:child_process";
import { visualQaEnvironment } from "./visual-qa-database.mjs";

const environment = visualQaEnvironment();
function run(command, args) {
  const result = spawnSync(command, args, { env: environment, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("docker", ["compose", "--profile", "visual-qa", "up", "-d", "--wait", "visual-qa-postgres"]);
run("pnpm", ["exec", "prisma", "migrate", "reset", "--force", "--skip-seed"]);
run("pnpm", ["exec", "tsx", "prisma/seed-visual-qa.ts"]);
console.log("Visual-QA database reset and seeded successfully.");
