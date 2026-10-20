import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { inspect } from "node:util";
import { key, plainError } from "./model.mjs";

const canonical = (file) => {
  try {
    return realpathSync(file);
  } catch {
    return resolve(file);
  }
};
const errorDetails = (error) => {
  const result = plainError(error);
  for (const name of ["actual", "expected"])
    if (error && typeof error === "object" && name in error)
      result[name] = inspect(error[name], {
        depth: 8,
        maxArrayLength: 100,
        maxStringLength: 10000,
      }).slice(0, 1024 * 1024);
  return result;
};

export function attachMochaReporter(
  runner,
  events,
  publish,
  { files = [], watch = false, dryRun = false } = {},
) {
  const records = new Map(),
    identities = new Map(),
    tests = new Map();
  let sequence = 0;
  const parallel = runner.isParallelMode();
  const fileFor = (path) => {
    if (!path) return null;
    const file = canonical(path);
    if (!records.has(file)) {
      const info = {
        id: key("mocha", file),
        file,
        project: "",
        status: "queued",
        errors: [],
        duration: null,
      };
      records.set(file, info);
      publish({ type: "file", file: info });
    }
    return records.get(file);
  };
  const identity = (test) => {
    // Retry clones point back to the original test. Parallel mode serializes
    // that reference; its native id still distinguishes duplicate titles.
    const origin = test.retriedTest?.() || test;
    const token = origin.id || origin.__mocha_id__ || origin;
    if (!identities.has(token)) identities.set(token, key("mocha", ++sequence));
    return identities.get(token);
  };
  const reportTest = (test, status, error) => {
    if (dryRun) return;
    const file = fileFor(test.file);
    if (!file) return;
    if (file.status === "queued") file.status = "running";
    if (status === "failed") file.status = "failed";
    const titlePath = test.titlePath?.() || [test.title];
    publish({ type: "file", file });
    const id = identity(test);
    tests.set(id, { fileId: file.id, status });
    publish({
      type: "test",
      test: {
        id,
        fileId: file.id,
        file: file.file,
        project: "",
        title: test.title,
        titlePath,
        status,
        nativeStatus: test.state || status,
        duration: test.duration ?? null,
        retry: test.currentRetry?.() || 0,
        errors: error ? [errorDetails(error)] : [],
      },
    });
  };
  runner.once(events.EVENT_RUN_BEGIN, () => {
    publish({ type: "start", files: [] });
    publish({
      type: "notice",
      message:
        "Mocha stdout/stderr is captured as run output; individual test log ownership is unavailable.",
    });
    if (parallel)
      publish({
        type: "notice",
        message:
          "Mocha parallel-mode results are buffered by the runner until each file finishes.",
      });
    if (dryRun)
      publish({
        type: "notice",
        message:
          "Mocha dry-run mode discovers tests without executing them; no assertion results are reported.",
      });
    for (const file of files) fileFor(file);
    if (!parallel && !dryRun)
      runner.suite.eachTest((test) => {
        runner._grep.lastIndex = 0;
        const matches = runner._grep.test(test.fullTitle());
        if (runner._invert ? !matches : matches) reportTest(test, "queued");
      });
  });
  runner.on(events.EVENT_TEST_BEGIN, (test) => reportTest(test, "running"));
  runner.on(events.EVENT_TEST_PASS, (test) => reportTest(test, "passed"));
  runner.on(events.EVENT_TEST_PENDING, (test) => reportTest(test, "skipped"));
  runner.on(events.EVENT_TEST_RETRY, (test) => reportTest(test, "running"));
  runner.on(events.EVENT_TEST_FAIL, (test, error) => {
    if (test.type === "test") reportTest(test, "failed", error);
    else {
      const detail = errorDetails(error),
        file = fileFor(test.file);
      detail.message = `${test.title}: ${detail.message || "Hook failed"}`;
      if (file) {
        file.errors.push(detail);
        file.status = "error";
        publish({ type: "file", file });
      } else publish({ type: "error", error: detail });
    }
  });
  runner.once(events.EVENT_RUN_END, () => {
    for (const file of records.values()) {
      if (file.errors.length) file.status = "error";
      else {
        const members = [...tests.values()].filter(
          (test) => test.fileId === file.id,
        );
        if (members.some((test) => test.status === "failed"))
          file.status = "failed";
        else if (
          members.some((test) => ["queued", "running"].includes(test.status))
        )
          file.status = "cancelled";
        else if (members.some((test) => test.status === "passed"))
          file.status = "passed";
        else
          file.status =
            parallel && runner.failures && !members.length
              ? "queued"
              : "skipped";
      }
      publish({ type: "file", file });
    }
    publish({ type: "end", failed: runner.failures > 0, watching: watch });
  });
}
