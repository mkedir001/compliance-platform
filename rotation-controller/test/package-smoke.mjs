import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const archive = resolve("dist/rotation-controller.zip");
const files = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
assert.deepEqual(files, ["index.js"]);
const directory = mkdtempSync(join(tmpdir(), "rotation-controller-"));
try {
  execFileSync("unzip", ["-q", archive, "-d", directory]);
  const result = spawnSync(process.execPath, ["-e", "const deployed=require('./index.js');if(typeof deployed.handler!=='function')process.exit(2);"], { cwd: directory, encoding: "utf8", env: { ...process.env, AWS_REGION: process.env.AWS_REGION ?? "us-east-2" } });
  assert.equal(result.status, 0, `Packaged controller failed initialization:\n${result.stderr || result.stdout}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
