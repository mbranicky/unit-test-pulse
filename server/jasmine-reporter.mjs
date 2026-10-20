import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { key, plainError } from "./model.mjs";

const canonical = (name) => {
  const file = name.startsWith("file:") ? fileURLToPath(name) : resolve(name);
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};
const details = (error) => {
  const result = plainError(error);
  for (const name of ["actual", "expected"])
    if (error && Object.hasOwn(error, name))
      result[name] = inspect(error[name], {
        depth: 8,
        maxArrayLength: 100,
        maxStringLength: 10000,
      }).slice(0, 1024 * 1024);
  return result;
};

export function jasmineReporter(publish, { tree, parallel = false } = {}) {
  const files = new Map(),
    tests = new Map(),
    paths = new Map(),
    suites = new Map();
  const fileFor = (name) => {
    if (!name) return null;
    const file = canonical(name);
    if (!files.has(file))
      files.set(file, {
        id: key("jasmine", file),
        file,
        project: "",
        status: "queued",
        duration: null,
        errors: [],
      });
    return files.get(file);
  };
  let incomplete = false;
  const identity = (result, file) => key("jasmine", file.file, result.id);
  const report = (result, status) => {
    const file = fileFor(result.filename);
    if (!file) {
      incomplete = true;
      publish({
        type: "error",
        error: {
          message: `Jasmine supplied no source file for ${result.fullName || result.description}; its result cannot be grouped reliably.`,
        },
      });
      return;
    }
    const id = identity(result, file);
    const titlePath = paths.get(id) || parallelPath(result, file);
    const test = {
      id,
      fileId: file.id,
      file: file.file,
      project: "",
      title: result.description,
      titlePath,
      status,
      nativeStatus: result.status || status,
      duration: result.duration ?? null,
      retry: 0,
      errors: (result.failedExpectations || []).map(details),
    };
    tests.set(id, test);
    if (status === "running" && file.status === "queued")
      file.status = "running";
    publish({ type: "file", file });
    publish({ type: "test", test });
    // These records have an explicit spec identity, unlike process output.
    for (const log of result.debugLogs || [])
      publish({
        type: "log",
        record: {
          stream: "console",
          level: "debug",
          testId: id,
          fileId: file.id,
          text: log.message,
        },
      });
    const reason = result.pendingReason || result.notApplicableReason;
    if (reason)
      publish({
        type: "log",
        record: {
          stream: "console",
          level: "info",
          testId: id,
          fileId: file.id,
          text: reason,
        },
      });
  };
  const suiteKey = (file, id) => key(file.file, id);
  function parallelPath(result, file) {
    const parents = [],
      seen = new Set();
    // Jasmine prefixes parallel event IDs with worker identity, but leaves
    // parentSuiteId local to the worker. Keep both worker and file in the key.
    const prefix = parallel
      ? result.id.slice(0, result.id.indexOf("-") + 1)
      : "";
    let id = result.parentSuiteId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const parent = suites.get(suiteKey(file, prefix + id));
      if (!parent) break;
      parents.unshift(parent.description);
      id = parent.parentSuiteId;
    }
    return [...parents, result.description];
  }
  const warnings = (result) => {
    for (const warning of result.deprecationWarnings || [])
      publish({ type: "notice", message: warning.message || String(warning) });
  };
  return {
    reporterCapabilities: { parallel: true },
    jasmineStarted(info) {
      publish({ type: "start", files: [] });
      publish({
        type: "notice",
        message:
          "Jasmine process output is run-scoped. Only Jasmine debug logs and pending reasons with an explicit spec identity appear in test logs.",
      });
      if (info.order?.random)
        publish({
          type: "notice",
          message: `Jasmine random seed: ${info.order.seed}`,
        });
      const visit = (node) => {
        if (node.children) for (const child of node.children) visit(child);
        else {
          const file = fileFor(node.filename);
          if (file) paths.set(identity(node, file), node.getPath());
          report(node, "queued");
        }
      };
      if (tree) visit(tree);
    },
    suiteStarted(result) {
      const file = fileFor(result.filename);
      if (file) suites.set(suiteKey(file, result.id), result);
    },
    specStarted(result) {
      report(result, "running");
    },
    specDone(result) {
      const status = {
        passed: "passed",
        failed: "failed",
        pending: "skipped",
        excluded: "skipped",
        notApplicable: "skipped",
      }[result.status];
      if (!status)
        publish({
          type: "error",
          error: {
            message: `Unrecognized Jasmine spec status: ${result.status}`,
          },
        });
      report(result, status || "cancelled");
      warnings(result);
    },
    suiteDone(result) {
      const file = fileFor(result.filename);
      for (const error of result.failedExpectations || []) {
        const detail = details(error);
        detail.message = `${result.fullName || result.description}: ${detail.message}`;
        if (file) {
          file.errors.push(detail);
          publish({ type: "file", file });
        } else publish({ type: "error", error: detail });
      }
      warnings(result);
    },
    jasmineDone(result) {
      for (const error of result.failedExpectations || [])
        publish({ type: "error", error: details(error) });
      if (result.overallStatus === "incomplete")
        publish({
          type: "notice",
          message: `Jasmine incomplete: ${result.incompleteReason || result.incompleteCode || "unspecified reason"}`,
        });
      const unresolved = [...tests.values()].some((test) =>
        ["queued", "running"].includes(test.status),
      );
      for (const file of files.values()) {
        const members = [...tests.values()].filter(
          (test) => test.fileId === file.id,
        );
        file.status = file.errors.length
          ? "error"
          : members.some((test) => test.status === "failed")
            ? "failed"
            : members.some((test) =>
                  ["queued", "running"].includes(test.status),
                )
              ? "cancelled"
              : members.some((test) => test.status === "passed")
                ? "passed"
                : "skipped";
        publish({ type: "file", file });
      }
      warnings(result);
      publish({
        type: "end",
        failed: result.overallStatus === "failed",
        complete: !incomplete && !unresolved,
      });
    },
  };
}
