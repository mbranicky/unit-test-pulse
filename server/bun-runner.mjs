import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { bunReporter } from "./bun-reporter.mjs";
import WebSocket from "ws";

export function launchBun(payload, send) {
  if (
    payload.args.some(
      (arg) =>
        /^(?:--inspect(?:-wait|-brk)?|--hot|--eval|--print|--help|--version)(?:=|$)/.test(
          arg,
        ) || ["-h", "-v", "-e", "-p"].includes(arg),
    ) ||
    Object.keys(process.env).some(
      (name) => name.startsWith("BUN_INSPECT") && process.env[name],
    )
  )
    throw new Error(
      "Bun monitoring owns a local inspector connection. Use native Bun for inspector/debugging, hot reload, help, version, and evaluation commands.",
    );
  if (
    payload.args.some((arg) => /^(--parallel|--test-worker)(?:=|$)/.test(arg))
  )
    throw new Error(
      "Bun's native parallel workers do not publish inspector test events. Run without --parallel; concurrent tests in one Bun process are supported.",
    );
  const reporter = bunReporter(send, { watch: payload.watch });
  const nonce = `pulse-${randomBytes(16).toString("hex")}`;
  const child = spawn(
    payload.executable,
    [
      "test",
      `--inspect-wait=127.0.0.1:0/${nonce}`,
      "--preload",
      fileURLToPath(new URL("./bun-barrier.mjs", import.meta.url)),
      ...(payload.watch ? ["--watch"] : []),
      ...payload.args,
    ],
    {
      cwd: payload.projectRoot,
      env: { ...process.env, UNIT_TEST_PULSE_BUN_BARRIER: nonce },
      stdio: ["inherit", "inherit", "pipe", "ipc"],
      detached: process.platform !== "win32",
    },
  );
  let socket,
    socketClosed = Promise.resolve(),
    childClosed = false,
    failure = false,
    closing = false,
    nextId = 0,
    stderr = "",
    lines = "",
    boundary = Promise.resolve();
  const connectedURLs = new Set();
  const pending = new Map(),
    decoder = new StringDecoder("utf8");
  const kill = (signal) => {
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const fail = (error) => {
    if (failure || closing || childClosed) return;
    failure = true;
    send({
      type: "error",
      error: { message: `Bun collection failed: ${error.message}` },
    });
    kill("SIGTERM");
  };
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Inspector command timed out: ${method}`));
      }, 5000);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  const startup = setTimeout(
    () =>
      fail(
        new Error(
          "The private Bun inspector did not become ready within 10 seconds.",
        ),
      ),
    10000,
  );
  startup.unref();
  function connect(url) {
    if (connectedURLs.has(url)) return;
    connectedURLs.add(url);
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
    socket = new WebSocket(url);
    socketClosed = new Promise((resolve) =>
      socket.addEventListener("close", resolve, { once: true }),
    );
    socket.addEventListener("message", ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.id) {
          const item = pending.get(message.id);
          if (!item) return;
          clearTimeout(item.timer);
          pending.delete(message.id);
          if (message.error) item.reject(new Error(message.error.message));
          else item.resolve(message.result);
        } else reporter.event(message);
      } catch (error) {
        fail(error);
      }
    });
    socket.addEventListener("open", async () => {
      try {
        for (const method of [
          "TestReporter.enable",
          "LifecycleReporter.enable",
          "Console.enable",
          "Inspector.initialized",
        ])
          await request(method);
        clearTimeout(startup);
      } catch (error) {
        fail(error);
      }
    });
    socket.addEventListener("error", () =>
      fail(new Error("The private Bun inspector connection failed.")),
    );
    socket.addEventListener("close", () => {
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("The Bun inspector disconnected."));
      }
      pending.clear();
      const disconnected = socket;
      const timer = setTimeout(() => {
        if (!childClosed && !closing && socket === disconnected)
          fail(
            new Error("The Bun inspector disconnected before execution ended."),
          );
      }, 1000);
      timer.unref();
    });
  }
  child.on("message", (message) => {
    if (message?.pulseBunBarrier !== nonce) return;
    void request("Runtime.evaluate", {
      expression: "void 0",
      returnByValue: true,
    })
      .then(() => {
        if (child.connected)
          child.send({ pulseBunBarrier: nonce, id: message.id }, (error) => {
            if (error && !childClosed && !closing) fail(error);
          });
      })
      .catch(fail);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    const text = decoder.write(chunk);
    stderr = (stderr + text).slice(-16384);
    lines += text;
    const endpoint = [
      ...stderr.matchAll(
        new RegExp(`ws://127\\.0\\.0\\.1:(\\d+)/${nonce}(?=[\\s]|$)`, "g"),
      ),
    ].at(-1);
    if (endpoint) connect(endpoint[0]);
    let newline;
    while ((newline = lines.indexOf("\n")) >= 0) {
      const line = lines
        .slice(0, newline)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .trim();
      lines = lines.slice(newline + 1);
      reporter.observeSummary(line);
      if (
        payload.watch &&
        (/^Ran \d+ tests? across \d+ files?\. \[.+\]$/.test(line) ||
          /^error: regex .* matched 0 tests\. Searched /.test(line))
      )
        boundary = boundary
          .then(async () => {
            if (socket?.readyState === WebSocket.OPEN) {
              await request("Runtime.evaluate", {
                expression: "void 0",
                returnByValue: true,
              });
              reporter.summary(line);
            }
          })
          .catch(fail);
    }
    if (lines.length > 65536) lines = lines.slice(-65536);
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      childClosed = true;
      resolve({ code, signal });
    });
  })
    .then(async (result) => {
      clearTimeout(startup);
      // Drain the WebSocket before finalizing; its last test event can arrive
      // after the process's output/close notifications on another pipe.
      if (socket) {
        await Promise.race([
          socketClosed,
          new Promise((resolve) => {
            const timer = setTimeout(resolve, 1000);
            timer.unref();
          }),
        ]);
        socket.close();
      }
      await boundary;
      reporter.finish({
        code: failure ? 1 : result.code,
        interrupted: !failure && Boolean(result.signal),
      });
      return failure ? { code: 1, signal: null } : result;
    })
    .finally(() => {
      clearTimeout(startup);
      socket?.close();
    });
  return {
    done,
    async close(signal = "SIGTERM") {
      closing = true;
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
