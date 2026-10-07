import { spawn } from "node:child_process";
import { visualQaEnvironment } from "./visual-qa-database.mjs";

const child = spawn("pnpm", ["exec", "next", "dev"], { env: visualQaEnvironment(), stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 0));
