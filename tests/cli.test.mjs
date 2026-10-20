import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
test("CLI: an npm-style executable symlink invokes the helper", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "pulse-cli-bin-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const alias = join(folder, "unit-test-pulse.mjs");
  await symlink(resolve(import.meta.dirname, "../server/cli.mjs"), alias);
  const result = await exec(process.execPath, [alias, "--help"]);
  assert.match(result.stdout, /Unit Test Pulse/);
  assert.match(result.stdout, /--runner/);
});
