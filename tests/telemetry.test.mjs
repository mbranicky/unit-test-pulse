import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  captureProcess,
  readRuns,
  waitForTelemetry,
} from "./support/telemetry.mjs";

// A long polling deadline must never hide an already-finished runner.
test(
  "telemetry wait stops on runner exit and preserves output and snapshots",
  { timeout: 5000 },
  async (t) => {
    const command = captureProcess(
      spawn(
        process.execPath,
        ["-e", "console.error('startup failure marker'); process.exitCode=7"],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    t.after(() => command.stop());
    await assert.rejects(
      waitForTelemetry(() => false, {
        commands: [command],
        timeout: 60000,
        snapshot: async () => [
          { id: "run-marker", status: "starting", tests: [] },
        ],
      }),
      (error) => {
        assert.match(error.message, /runner exited/i);
        assert.match(error.message, /startup failure marker/);
        assert.match(error.message, /run-marker/);
        assert.match(error.message, /"code":7/);
        return true;
      },
    );
  },
);

test("a final snapshot published during exit is checked before an exit failure", async (t) => {
  const command = captureProcess(
    spawn(process.execPath, ["-e", "process.exitCode=0"], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  t.after(() => command.stop());
  let visible = false;
  command.done.then(() => {
    visible = true;
  });
  const readSnapshot = async () => {
    const observed = visible;
    await command.done;
    return observed ? "final snapshot" : false;
  };
  assert.equal(
    await waitForTelemetry(readSnapshot, {
      commands: [command],
      snapshot: async () => [],
    }),
    "final snapshot",
  );
});

test("snapshot reads tolerate a record being created without hiding damaged snapshots", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pulse-telemetry-reader-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const complete = join(root, "runs", "complete"),
    creating = join(root, "runs", "creating");
  await mkdir(complete, { recursive: true });
  await mkdir(creating);
  await writeFile(
    join(complete, "summary.json"),
    JSON.stringify({ id: "complete", cycle: 1 }),
  );
  assert.deepEqual(await readRuns(root), [{ id: "complete", cycle: 1 }]);
  await writeFile(join(creating, "summary.json"), "{broken");
  await assert.rejects(
    readRuns(root),
    /Could not read integration snapshot.*creating/,
  );
});
