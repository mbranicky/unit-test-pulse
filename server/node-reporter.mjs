import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { inspect } from "node:util";
import { key, plainError } from "./model.mjs";
import send from "./channel.cjs";

const canonical = (file) => {
  try {
    return realpathSync(file);
  } catch {
    return resolve(file);
  }
};
function assertionError(error) {
  // Node wraps assertion and hook errors in ERR_TEST_FAILURE. Keep the original
  // stack and structured values rather than the wrapper's runner-only stack.
  const original = error?.cause instanceof Error ? error.cause : error;
  const result = plainError(original);
  if (["simple", "full"].includes(result.diff)) delete result.diff;
  for (const name of ["actual", "expected"])
    if (original && typeof original === "object" && name in original)
      result[name] = inspect(original[name], {
        depth: 8,
        maxArrayLength: 100,
        maxStringLength: 10000,
      }).slice(0, 1024 * 1024);
  return result;
}

export function nodeReporter(publish, { watch = false } = {}) {
  let files,
    paths,
    occurrences,
    summaries,
    active = false,
    failed = false;
  function start() {
    files = new Map();
    paths = new Map();
    occurrences = new Map();
    summaries = new Set();
    active = true;
    failed = false;
    publish({ type: "start", files: [] });
    publish({
      type: "notice",
      message:
        "Node.js output is file-scoped when supplied by the runner; individual test ownership is unavailable. Results follow Node's declaration-ordered reporting and may be delayed by earlier concurrent tests.",
    });
  }
  function fileFor(path) {
    const file = canonical(path);
    if (!files.has(file)) {
      const info = {
        id: key("node", file),
        file,
        project: "",
        status: "running",
        errors: [],
        duration: null,
      };
      files.set(file, info);
      publish({ type: "file", file: info });
    }
    return files.get(file);
  }
  function finish() {
    if (!active) return;
    for (const file of files.values()) {
      if (file.status === "running")
        file.status = file.errors.length ? "error" : "passed";
      publish({ type: "file", file });
    }
    publish({ type: "end", failed, watching: watch });
    active = false;
  }
  start();
  return {
    event({ type, data = {} }) {
      if (type === "test:watch:restarted") return;
      if (type === "test:watch:drained") return;
      if (type === "test:summary" && !data.file) {
        if (!active) return;
        failed ||= !data.success;
        finish();
        return;
      }
      // Summary/diagnostic events can trail a completed watch cycle. Only real
      // execution or output events begin the next cycle.
      if (!active) {
        if (
          ![
            "test:enqueue",
            "test:dequeue",
            "test:start",
            "test:pass",
            "test:fail",
            "test:stdout",
            "test:stderr",
          ].includes(type)
        )
          return;
        start();
      }
      if (!data.file) return;
      const file = fileFor(data.file);
      if (type === "test:summary") {
        summaries.add(file.id);
        return;
      }
      const wrapper =
        data.nesting === 0 &&
        data.line === 1 &&
        data.column === 1 &&
        typeof data.name === "string" &&
        canonical(data.name) === file.file;
      if (type === "test:stdout" || type === "test:stderr") {
        publish({
          type: "log",
          record: {
            stream: "console",
            level: type === "test:stderr" ? "stderr" : "stdout",
            fileId: file.id,
            text: data.message,
          },
        });
      }
      if (type === "test:diagnostic")
        publish({
          type: "log",
          record: {
            stream: "console",
            level: data.level || "diagnostic",
            fileId: file.id,
            text: data.message,
          },
        });
      if (type === "test:start" && !wrapper) {
        const path = paths.get(file.id) || [];
        path.length = data.nesting;
        path.push(data.name);
        paths.set(file.id, path);
      }
      if (type === "test:complete" && wrapper) {
        file.duration = data.details?.duration_ms ?? null;
        file.status = data.details?.passed ? "passed" : "failed";
        if (
          data.details?.error &&
          data.details.error.failureType !== "subtestsFailed"
        ) {
          file.errors.push(assertionError(data.details.error));
          file.status = "error";
          failed = true;
        }
        publish({ type: "file", file });
      }
      if (type !== "test:pass" && type !== "test:fail") return;
      const error = data.details?.error;
      const unsuccessful =
        type === "test:fail" &&
        data.todo === undefined &&
        data.skip === undefined;
      failed ||= unsuccessful;
      if (wrapper && !error && summaries.has(file.id)) return;
      if (wrapper && error) {
        if (!file.errors.length) file.errors.push(assertionError(error));
        file.status = "error";
        publish({ type: "file", file });
        return;
      }
      if (data.details?.type === "suite") {
        if (unsuccessful && error?.failureType !== "subtestsFailed") {
          file.errors.push(assertionError(error));
          publish({ type: "file", file });
        }
        return;
      }
      const titlePath = wrapper
        ? [data.name]
        : [...(paths.get(file.id) || []).slice(0, data.nesting), data.name];
      const identity = key(file.id, titlePath, data.line, data.column);
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      const cancelled = [
        "cancelledByParent",
        "aborted",
        "testAborted",
        "testTimeoutFailure",
      ].includes(error?.failureType);
      const status =
        data.skip !== undefined
          ? "skipped"
          : data.todo !== undefined
            ? "todo"
            : unsuccessful
              ? cancelled
                ? "cancelled"
                : "failed"
              : "passed";
      if (unsuccessful) file.status = "failed";
      publish({
        type: "test",
        test: {
          id: key(identity, occurrence),
          fileId: file.id,
          file: file.file,
          project: "",
          title: data.name,
          titlePath,
          status,
          nativeStatus: type,
          duration: data.details?.duration_ms ?? null,
          retry: 0,
          errors: error ? [assertionError(error)] : [],
          location: data.line
            ? { line: data.line, column: data.column || 1 }
            : null,
        },
      });
    },
    finish,
  };
}

export default async function* reporter(source) {
  process.channel?.unref();
  const reporter = nodeReporter(send, {
    watch: process.env.UNIT_TEST_PULSE_NODE_WATCH === "1",
  });
  try {
    for await (const event of source) reporter.event(event);
    reporter.finish();
  } finally {
    if (process.connected) process.disconnect();
  }
}
