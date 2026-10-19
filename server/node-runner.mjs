import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// NODE_OPTIONS uses double quotes and backslash escapes, not shell expansion.
export function splitNodeOptions(value = "") {
  const tokens = [];
  let token = "",
    quoted = false,
    started = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (char === "\\" && quoted) {
      if (++i >= value.length)
        throw new Error("Invalid escape in NODE_OPTIONS.");
      token += value[i];
      started = true;
    } else if (/\s/.test(char) && !quoted) {
      if (started) tokens.push(token);
      token = "";
      started = false;
    } else {
      token += char;
      started = true;
    }
  }
  if (quoted) throw new Error("Unclosed quote in NODE_OPTIONS.");
  if (started) tokens.push(token);
  return tokens;
}
function takeReporters(args) {
  const rest = [],
    reporters = [],
    destinations = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") {
      rest.push(...args.slice(i));
      break;
    }
    const match = /^(--test-reporter(?:-destination)?)(?:=(.*))?$/.exec(
      args[i],
    );
    if (!match) {
      rest.push(args[i]);
      continue;
    }
    const value = match[2] ?? args[++i];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for ${match[1]}.`);
    (match[1] === "--test-reporter" ? reporters : destinations).push(value);
  }
  return { rest, reporters, destinations };
}
export function nodeInvocation(args, watch, environment = process.env) {
  if (
    args.some((arg) =>
      [
        "--help",
        "-h",
        "--version",
        "-v",
        "--eval",
        "-e",
        "--print",
        "-p",
      ].includes(arg),
    )
  )
    throw new Error(
      "Use native Node.js for help, version, and evaluation commands.",
    );
  const native = takeReporters(args);
  const inherited = takeReporters(splitNodeOptions(environment.NODE_OPTIONS));
  const reporters = [...inherited.reporters, ...native.reporters];
  const destinations = [...inherited.destinations, ...native.destinations];
  if (!reporters.length)
    reporters.push(
      Number(process.versions.node.split(".")[0]) >= 24 ? "spec" : "tap",
    );
  if (!destinations.length && reporters.length === 1)
    destinations.push("stdout");
  if (reporters.length !== destinations.length)
    throw new Error(
      "Node.js requires one --test-reporter-destination for each --test-reporter when using multiple reporters.",
    );
  const env = { ...environment, UNIT_TEST_PULSE_NODE_WATCH: watch ? "1" : "0" };
  // A fresh runner must not inherit the enclosing node:test worker identity.
  // Otherwise Node suppresses all execution as a recursive test run.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  if (inherited.reporters.length || inherited.destinations.length)
    env.NODE_OPTIONS = inherited.rest
      .map((token) => JSON.stringify(token))
      .join(" ");
  const flags = ["--test", ...(watch ? ["--watch"] : [])];
  reporters.push(
    fileURLToPath(new URL("./node-reporter.mjs", import.meta.url)),
  );
  destinations.push("stdout");
  for (let i = 0; i < reporters.length; i++)
    flags.push(
      `--test-reporter=${reporters[i]}`,
      `--test-reporter-destination=${destinations[i]}`,
    );
  return { args: [...flags, ...native.rest], env };
}
export function launchNode(payload, send) {
  const invocation = nodeInvocation(payload.args, payload.watch);
  const child = spawn(process.execPath, invocation.args, {
    cwd: payload.projectRoot,
    env: invocation.env,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  child.on("message", (message) => {
    if (message?.pulse) send(message.event);
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return {
    done,
    async close(signal = "SIGTERM") {
      child.kill(signal);
      const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
      timer.unref();
      try {
        await done;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
