import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export function launchJasmine(payload, send) {
  if (
    payload.watch ||
    payload.args.some((arg) => /^(?:--watch|-w)(?:=|$)/.test(arg))
  )
    throw new Error(
      "Jasmine has no native watch mode. Run a one-shot command without --watch.",
    );
  if (
    payload.args.some((arg) =>
      [
        "init",
        "examples",
        "help",
        "version",
        "enumerate",
        "-h",
        "-v",
        "--help",
        "--version",
      ].includes(arg),
    )
  )
    throw new Error(
      "Use native Jasmine for initialization, examples, help, version, and enumeration.",
    );
  const require = createRequire(join(payload.projectRoot, "package.json"));
  const entry = require.resolve("jasmine");
  const folder = mkdtempSync(join(tmpdir(), "unit-test-pulse-jasmine-"));
  const journal = join(folder, "events.jsonl");
  writeFileSync(journal, "", { mode: 0o600 });
  const fd = openSync(journal, "r");
  let offset = 0,
    buffered = Buffer.alloc(0),
    captureError = false;
  // Jasmine exits explicitly on completion. Synchronous journal writes preserve
  // final results without changing its exit policy or using the test IPC channel.
  const drain = () => {
    try {
      let remaining = fstatSync(fd).size - offset;
      while (remaining > 0) {
        const buffer = Buffer.alloc(Math.min(remaining, 64 * 1024));
        const bytes = readSync(fd, buffer, 0, buffer.length, offset);
        if (!bytes) break;
        offset += bytes;
        remaining -= bytes;
        // Retain bytes across reads so multi-byte UTF-8 and partial lines survive.
        buffered = Buffer.concat([buffered, buffer.subarray(0, bytes)]);
        let end;
        while ((end = buffered.indexOf(10)) >= 0) {
          const line = buffered.subarray(0, end).toString("utf8");
          buffered = buffered.subarray(end + 1);
          if (line) send(JSON.parse(line));
        }
      }
    } catch (error) {
      if (!captureError) {
        captureError = true;
        send({
          type: "error",
          error: {
            message: `Jasmine telemetry could not be read: ${error.message}`,
          },
        });
      }
    }
  };
  const child = spawn(
    process.execPath,
    [
      "--import",
      fileURLToPath(new URL("./jasmine-bridge.mjs", import.meta.url)),
      join(dirname(entry), "../bin/jasmine.js"),
      ...payload.args,
    ],
    {
      cwd: payload.projectRoot,
      env: {
        ...process.env,
        UNIT_TEST_PULSE_JASMINE_JOURNAL: journal,
        UNIT_TEST_PULSE_JASMINE_ENTRY: entry,
      },
      stdio: ["inherit", "inherit", "inherit"],
      // Killing the process group also stops Jasmine's parallel workers.
      detached: process.platform !== "win32",
    },
  );
  const interval = setInterval(drain, 50);
  const cleanup = () => {
    clearInterval(interval);
    drain();
    closeSync(fd);
    rmSync(folder, { recursive: true, force: true });
  };
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(cleanup);
  return {
    done,
    async close(signal = "SIGTERM") {
      const kill = (value) => {
        try {
          if (process.platform === "win32") child.kill(value);
          else process.kill(-child.pid, value);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      };
      kill(signal);
      const timer = setTimeout(() => kill("SIGKILL"), 2000);
      timer.unref();
      try {
        await done;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
