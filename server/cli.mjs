#!/usr/bin/env node
import { fork } from "node:child_process";
import { realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discover, stateRoot, inside } from "./environment.mjs";
import { createState, reduce, snapshot, plainError } from "./model.mjs";
import {
  saveRun,
  listRuns,
  readRun,
  readLogs,
  logWriter,
  prune,
} from "./store.mjs";
const help = `Unit Test Pulse\n\n  doctor --project PATH\n  run --project PATH [--workspace PATH] [--runner vitest|jest|node] [--watch] -- RUNNER_ARGUMENTS\n  list --project PATH\n  show --project PATH --run-id ID\n  logs --project PATH --run-id ID [--test-id ID] [--file-id ID] [--cursor N] [--search TEXT]\n\nUse --state-dir PATH before -- to override local state. Runner arguments after -- retain their native meaning; use helper --watch to enable watching.\n`;
function parse(args) {
  const split = args.indexOf("--"),
    before = split < 0 ? args : args.slice(0, split),
    native = split < 0 ? [] : args.slice(split + 1);
  const [command = "help", ...tokens] = before,
    options = {};
  const values = new Set([
    "project",
    "workspace",
    "runner",
    "state-dir",
    "run-id",
    "test-id",
    "file-id",
    "cursor",
    "search",
  ]);
  for (let i = 0; i < tokens.length; i++) {
    const option = tokens[i].replace(/^--/, "");
    if (tokens[i] === "--watch") options.watch = true;
    else if (
      values.has(option) &&
      tokens[i + 1] &&
      !tokens[i + 1].startsWith("--")
    )
      options[option] = tokens[++i];
    else throw new Error(`Unknown or incomplete helper option: ${tokens[i]}`);
  }
  return { command, options, native };
}
export async function main(args = process.argv.slice(2)) {
  const { command, options, native } = parse(args);
  if (command === "help" || command === "--help") {
    console.log(help);
    return 0;
  }
  if (options["state-dir"])
    process.env.UNIT_TEST_PULSE_STATE_DIR = resolve(options["state-dir"]);
  const projectRoot = realpathSync(resolve(options.project || process.cwd()));
  if (command === "doctor") {
    console.log(
      JSON.stringify(
        {
          projectRoot,
          node: process.version,
          stateDirectory: stateRoot(),
          runners: discover(projectRoot),
          notice:
            "Use the existing project startup/environment and loader settings. This helper launches the runner directly; it does not execute package-script prerequisites.",
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "list") {
    const { runs, notices } = listRuns(projectRoot);
    console.log(
      JSON.stringify(
        { runs: runs.map(({ tests, files, ...run }) => run), notices },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === "show") {
    console.log(
      JSON.stringify(readRun(options["run-id"], projectRoot), null, 2),
    );
    return 0;
  }
  if (command === "logs") {
    const cursor = Number(options.cursor || 0);
    if (!Number.isInteger(cursor) || cursor < 0)
      throw new Error("Cursor must be a non-negative integer.");
    console.log(
      JSON.stringify(
        readLogs(options["run-id"], projectRoot, {
          cursor,
          testId: options["test-id"],
          fileId: options["file-id"],
          search: options.search,
        }),
        null,
        2,
      ),
    );
    return 0;
  }
  if (command !== "run") throw new Error(`Unknown command: ${command}`);
  const candidates = discover(projectRoot),
    packages = candidates.filter((runner) => runner.runner !== "node"),
    selected = options.runner
      ? candidates.find((r) => r.runner === options.runner)
      : packages.length === 1
        ? packages[0]
        : packages.length === 0
          ? candidates.find((runner) => runner.runner === "node")
          : null;
  if (!selected)
    throw new Error(
      "Select a runner with --runner vitest, --runner jest, or --runner node. Run doctor to see candidates.",
    );
  if (!selected.supported)
    throw new Error(
      `Unsupported ${selected.runner} ${selected.version}. Integrations target Vitest 4.x/5.x, Jest 30.x, and Node.js 22.x/24.x; see README for tested versions.`,
    );
  if (selected.runner === "node" && native.includes("--watch"))
    options.watch = true;
  const workspaceRoot = realpathSync(resolve(options.workspace || projectRoot));
  if (!inside(workspaceRoot, projectRoot))
    throw new Error("The test project must be inside the selected workspace.");
  const sessionId = randomBytes(16).toString("hex");
  let state,
    writeLog,
    pending,
    cycle = 0,
    interrupted = false;
  const root = stateRoot();
  const flush = () => {
    clearTimeout(pending);
    pending = null;
    if (state) saveRun(snapshot(state), root);
  };
  const schedule = () => {
    if (!pending) pending = setTimeout(flush, 120);
  };
  function start() {
    if (state) {
      state.watching = false;
      flush();
      prune(root);
    }
    state = createState({
      id: randomBytes(16).toString("hex"),
      sessionId,
      cycle: ++cycle,
      projectRoot,
      workspaceRoot,
      runner: selected.runner,
      runnerVersion: selected.version,
      mode: options.watch ? "watch" : "run",
      ownerPid: process.pid,
    });
    writeLog = logWriter(state.id, root, (message) => {
      if (!state.notices.some((n) => n.startsWith(message.split(";")[0])))
        reduce(state, { type: "notice", message });
      schedule();
    });
    if (selected.runner === "jest")
      reduce(state, {
        type: "notice",
        message:
          "Jest console records are file-scoped when supplied at completion. Process output is unassigned to tests.",
      });
    saveRun(snapshot(state), root);
    console.error(`[Unit Test Pulse] Run ${state.id}`);
  }
  start();
  const child = fork(
    fileURLToPath(new URL("./worker.mjs", import.meta.url)),
    [],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        UNIT_TEST_PULSE_PAYLOAD: JSON.stringify({
          projectRoot,
          runner: selected.runner,
          version: selected.version,
          args: native,
          watch: Boolean(options.watch),
        }),
      },
      stdio: ["inherit", "pipe", "pipe", "ipc"],
      execArgv: process.execArgv.filter((a) => !a.startsWith("--test")),
    },
  );
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    writeLog({ stream: "stdout", text: chunk.toString("utf8") });
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    writeLog({ stream: "stderr", text: chunk.toString("utf8") });
  });
  child.on("message", (message) => {
    if (!message?.pulse) return;
    const event = message.event;
    if (event.type === "start" && state.endedAt) start();
    if (event.type === "interrupted") {
      interrupted = true;
      return;
    }
    if (event.type === "log") writeLog(event.record);
    else {
      reduce(state, event);
      if (event.type === "end") flush();
      else schedule();
    }
  });
  child.on("error", (error) => {
    reduce(state, { type: "error", error: plainError(error) });
    flush();
  });
  let killTimer;
  const forward = (signal) => {
    interrupted = true;
    child.kill(signal);
    killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    killTimer.unref();
  };
  const sigint = () => forward("SIGINT"),
    sigterm = () => forward("SIGTERM");
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  const result = await new Promise((resolveResult) =>
    child.once("close", (code, signal) => resolveResult({ code, signal })),
  );
  clearTimeout(killTimer);
  process.off("SIGINT", sigint);
  process.off("SIGTERM", sigterm);
  reduce(state, {
    type: "exit",
    code: result.code,
    signal: result.signal || (interrupted ? "SIGINT" : null),
  });
  flush();
  prune(root);
  return result.code ?? 130;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
