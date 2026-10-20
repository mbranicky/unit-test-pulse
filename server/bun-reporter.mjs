import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { key } from "./model.mjs";
const canonical = (path) => {
  const file = path.startsWith("file:") ? fileURLToPath(path) : resolve(path);
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};
const terminal = new Set([
  "pass",
  "fail",
  "timeout",
  "skip",
  "todo",
  "skipped_because_label",
]);

export function bunReporter(publish, { watch = false } = {}) {
  let files,
    found,
    entries,
    scripts,
    consoleText,
    nativeSummary,
    lifecycleErrors,
    active = false;
  function start() {
    files = new Map();
    found = new Map();
    entries = new Map();
    scripts = new Map();
    consoleText = [];
    nativeSummary = null;
    lifecycleErrors = [];
    active = true;
    publish({ type: "start", files: [] });
    publish({
      type: "notice",
      message:
        "Bun console output and lifecycle errors are run-scoped: the inspector supplies no owning test identity. Open Run output for failure messages and available stack frames.",
    });
  }
  start();
  const fileFor = (url) => {
    if (!url) return null;
    const file = canonical(url);
    if (!files.has(file)) {
      const info = {
        id: key("bun", file),
        file,
        project: "",
        status: "running",
        duration: null,
        errors: [],
      };
      files.set(file, info);
      publish({ type: "file", file: info });
    }
    return files.get(file);
  };
  function report(meta) {
    if (meta.type === "describe" || meta.status === "skipped_because_label")
      return;
    const file = fileFor(meta.url || scripts.get(meta.scriptId));
    if (!file) return;
    const parents = [];
    let parent = found.get(meta.parentId);
    const seen = new Set();
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (parent.name) parents.unshift(parent.name);
      parent = found.get(parent.parentId);
    }
    const status =
      {
        pass: "passed",
        fail: "failed",
        timeout: "failed",
        skip: "skipped",
        todo: "todo",
      }[meta.status] || "running";
    const id = key("bun", meta.id, meta.occurrence || 0);
    const item = {
      id,
      fileId: file.id,
      file: file.file,
      project: "",
      title: meta.name || "(unnamed test)",
      titlePath: [...parents, meta.name || "(unnamed test)"],
      status,
      nativeStatus: meta.status || "running",
      retry: Math.max(0, (meta.starts || 1) - 1),
      // Bun 1.4 emits nanoseconds here despite the protocol describing milliseconds.
      duration: meta.elapsed == null ? null : meta.elapsed / 1e6,
      errors:
        status === "failed"
          ? [
              {
                message:
                  meta.status === "timeout"
                    ? "Bun reported a test timeout. Open Run output for captured diagnostics."
                    : "Bun reported this test as failed. Open Run output for failure messages, diffs, and available stack frames.",
              },
            ]
          : [],
      location: meta.line > 0 ? { line: meta.line, column: 1 } : null,
    };
    entries.set(id, item);
    publish({ type: "test", test: item });
  }
  function finish({ code = null, interrupted = false } = {}) {
    if (!active) return;
    const unresolved = [...found.values()].filter(
      (meta) => meta.type !== "describe" && !terminal.has(meta.status),
    );
    for (const meta of unresolved) report(meta);
    const retries = [...entries.values()].reduce(
      (sum, test) => sum + test.retry,
      0,
    );
    const failedTests = [...entries.values()].filter(
      (test) => test.status === "failed",
    ).length;
    const unassignedErrors = Math.max(
      0,
      lifecycleErrors.length - retries - failedTests,
    );
    // Bun counts failed hooks as unnamed tests in its terminal summary but
    // supplies those failures only through LifecycleReporter, without a test id.
    const knownErrorGap =
      nativeSummary &&
      nativeSummary.tests > entries.size &&
      nativeSummary.tests - entries.size <= unassignedErrors;
    const missing =
      nativeSummary &&
      ((!knownErrorGap && nativeSummary.tests !== entries.size) ||
        (nativeSummary.files !== files.size &&
          !(
            nativeSummary.tests === 0 &&
            entries.size === 0 &&
            files.size === 0
          )));
    if (missing)
      publish({
        type: "error",
        error: {
          message: `Bun reported ${nativeSummary.tests} tests in ${nativeSummary.files} files, but the observer captured ${entries.size} tests in ${files.size} files. Results are incomplete.`,
        },
      });

    if (
      !interrupted &&
      lifecycleErrors.length > retries &&
      ![...entries.values()].some((test) => test.status === "failed")
    )
      for (const error of lifecycleErrors) publish({ type: "error", error });
    for (const file of files.values()) {
      const members = [...entries.values()].filter(
        (test) => test.fileId === file.id,
      );
      file.status = unresolved.some(
        (meta) =>
          canonical(meta.url || scripts.get(meta.scriptId) || file.file) ===
          file.file,
      )
        ? "queued"
        : members.some((test) => test.status === "failed")
          ? "failed"
          : members.some((test) => test.status === "passed")
            ? "passed"
            : "skipped";
      publish({ type: "file", file });
    }
    if (
      code !== null &&
      code !== 0 &&
      ![...entries.values()].some((test) => test.status === "failed")
    )
      publish({
        type: "error",
        error: {
          message:
            "Bun exited unsuccessfully after the captured assertions. Inspect Run output for configuration, hook, coverage, or runtime failures.",
        },
      });
    publish({
      type: "end",
      failed: code !== null && code !== 0,
      complete: !missing && unresolved.length === 0,
      watching: watch,
      interrupted,
    });
    active = false;
  }
  return {
    event({ method, params = {} }) {
      if (method === "LifecycleReporter.reload") {
        if (active) finish({ interrupted: true });
        start();
        return;
      }
      if (!active && method === "TestReporter.found") start();
      if (method === "Debugger.scriptParsed")
        scripts.set(params.scriptId, params.url);
      if (method === "TestReporter.found") {
        const parent = found.get(params.parentId);
        const meta = {
          ...params,
          url: params.url || scripts.get(params.scriptId) || parent?.url,
          starts: 0,
        };
        found.set(params.id, meta);
        fileFor(meta.url);
      }
      if (method === "TestReporter.start") {
        const meta = found.get(params.id);
        if (!meta) return;
        if (terminal.has(meta.status)) {
          meta.occurrence = (meta.occurrence || 0) + 1;
          meta.starts = 0;
        }
        meta.starts++;
        meta.status = "running";
        meta.elapsed = null;
        report(meta);
      }
      if (method === "TestReporter.end") {
        const meta = found.get(params.id);
        if (!meta) return;
        Object.assign(meta, params);
        report(meta);
      }
      if (method === "Console.messageAdded") {
        const message = params.message;
        // Keep only bounded summary lookalikes, not a second copy of all logs.
        for (const raw of (message.text || "").split(/\r?\n/)) {
          if (raw.length > 16384) continue;
          const line = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim();
          if (
            /^(Ran \d+ tests? across |error: regex .* matched 0 tests\.)/.test(
              line,
            )
          ) {
            consoleText.push(line);
            if (consoleText.length > 1000) consoleText.shift();
          }
        }
        publish({
          type: "log",
          record: {
            stream: "console",
            level: message.level,
            text: message.text || "",
          },
        });
      }
      if (method === "LifecycleReporter.error") {
        const stack = (params.urls || [])
          .map(
            (url, i) =>
              `    at ${url}:${params.lineColumns?.[i * 2] || 1}:${params.lineColumns?.[i * 2 + 1] || 1}`,
          )
          .join("\n");
        lifecycleErrors.push({
          name: params.name || "Error",
          message: params.message || "Bun lifecycle error",
          ...(stack ? { stack } : {}),
        });
        publish({
          type: "log",
          record: {
            stream: "console",
            level: "error",
            text: `${params.name || "Error"}: ${params.message || ""}${stack ? "\n" + stack : ""}`,
          },
        });
      }
    },
    // Native watch mode has no structured cycle-end event. Validate its summary
    // against structured results after a protocol barrier; console lookalikes
    // are ignored. Test outcomes themselves are never parsed from terminal text.
    summary(line) {
      if (!active || consoleText.includes(line)) return false;
      let match = /^Ran (\d+) tests? across (\d+) files?\. \[.+\]$/.exec(line);
      const empty =
        /^error: regex .* matched 0 tests\. Searched (\d+) files? \(skipping \d+ tests?\) \[.+\]$/.exec(
          line,
        );
      if (!match && empty) match = [line, "0", empty[1]];
      if (!match) return false;
      const selected = [...found.values()].filter(
        (meta) =>
          meta.type !== "describe" && meta.status !== "skipped_because_label",
      );
      if (
        selected.some((meta) => !terminal.has(meta.status)) ||
        (selected.length !== Number(match[1]) &&
          !(
            Number(match[1]) > selected.length &&
            Number(match[1]) - selected.length <=
              Math.max(
                0,
                lifecycleErrors.length -
                  [...entries.values()].reduce(
                    (sum, test) =>
                      sum + test.retry + (test.status === "failed" ? 1 : 0),
                    0,
                  ),
              )
          )) ||
        (files.size !== Number(match[2]) &&
          !(
            Number(match[1]) === 0 &&
            selected.length === 0 &&
            files.size === 0
          ))
      )
        return false;
      finish();
      return true;
    },
    observeSummary(line) {
      const match = /^Ran (\d+) tests? across (\d+) files?\. \[.+\]$/.exec(
        line,
      );
      if (match)
        nativeSummary = { tests: Number(match[1]), files: Number(match[2]) };
    },
    finish,
  };
}
