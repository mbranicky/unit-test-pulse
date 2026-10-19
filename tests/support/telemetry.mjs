import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Stringified into runner fixtures, so this function must be self-contained.
// A file gate allows a real test to stay active until its observer is ready.
export async function waitForRelease() {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const gate = process.env.UNIT_TEST_PULSE_TEST_GATE;
  if (!gate) {
    await pause(1200);
    return;
  }
  const fs =
    typeof require === "function"
      ? require("node:fs")
      : await import("node:fs");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (fs.existsSync(gate)) return;
    await pause(20);
  }
  throw new Error("The integration observer did not release the test fixture.");
}

export function createGate(state) {
  const path = join(state, `gate-${randomUUID()}`);
  return { path, release: () => writeFile(path, "released") };
}

export function captureProcess(proc) {
  let text = "",
    closed = false,
    outcome;
  proc.stdout?.on("data", (chunk) => {
    text = (text + chunk).slice(-65536);
  });
  proc.stderr?.on("data", (chunk) => {
    text = (text + chunk).slice(-65536);
  });
  proc.on("error", (error) => {
    text += `\n${error.stack || error.message}`;
  });
  const done = new Promise((resolve) =>
    proc.once("close", (code, signal) => {
      closed = true;
      outcome = { code, signal, text, output: text };
      resolve(outcome);
    }),
  );
  return {
    proc,
    done,
    get closed() {
      return closed;
    },
    get output() {
      return text;
    },
    get outcome() {
      return outcome;
    },
    async stop() {
      if (closed) return done;
      proc.kill("SIGTERM");
      const timer = setTimeout(() => proc.kill("SIGKILL"), 3000);
      timer.unref();
      try {
        return await done;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export async function readRuns(state) {
  let ids;
  try {
    ids = await readdir(join(state, "runs"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const runs = await Promise.all(
    ids.map(async (id) => {
      const path = join(state, "runs", id, "summary.json");
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error(
          `Could not read integration snapshot ${path}: ${error.message}`,
          { cause: error },
        );
      }
    }),
  );
  return runs.filter(Boolean).sort((a, b) => a.cycle - b.cycle);
}

export async function waitForTelemetry(
  predicate,
  { commands, snapshot, timeout = 20000 },
) {
  const deadline = Date.now() + timeout;
  let reason;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    if (commands.some((command) => command.closed)) {
      // The process may have closed while the preceding snapshot was read.
      const final = await predicate();
      if (final) return final;
      reason = "A runner exited before the expected telemetry was observed.";
      break;
    }
    await Promise.race([pause(50), ...commands.map((command) => command.done)]);
  }
  const snapshots = await snapshot();
  throw new Error(
    [
      reason || "Timed out waiting for runner telemetry.",
      `Last snapshots: ${JSON.stringify(snapshots).slice(-32768)}`,
      ...commands.map(
        (command, i) =>
          `Command ${i + 1}: ${JSON.stringify(command.outcome || { running: true })}\n${command.output}`,
      ),
    ].join("\n"),
  );
}
