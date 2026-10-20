const { createHash } = require("node:crypto");
const key = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
const send = require("./channel.cjs");
const error = (value) => ({
  message: String(value?.message || value || "").slice(0, 1024 * 1024),
  ...(value?.stack ? { stack: String(value.stack).slice(0, 1024 * 1024) } : {}),
});
const completions = new Set();
module.exports = class PulseReporter {
  constructor(config) {
    this.watch = config.watch || config.watchAll;
    this.identities = new Map();
  }
  file(test) {
    return {
      id: key(test.context.config.id, test.path),
      file: test.path,
      project: test.context.config.displayName?.name || "",
    };
  }
  test(test, result, occurrence) {
    const file = this.file(test),
      titles = [...(result.ancestorTitles || []), result.title];
    const n = occurrence ?? 0;
    return {
      id: key(file.id, titles, result.location || null, n),
      fileId: file.id,
      file: file.file,
      project: file.project,
      title: result.title,
      titlePath: titles,
      status:
        { pending: "skipped", disabled: "skipped", focused: "queued" }[
          result.status
        ] || result.status,
      nativeStatus: result.status,
      duration: result.duration ?? null,
      retry: Math.max(0, (result.invocations || 1) - 1),
      errors: (result.failureMessages || []).map(error),
      location: result.location || null,
    };
  }
  onRunStart() {
    this.identities.clear();
    send({ type: "start", files: [] });
  }
  onTestFileStart(test) {
    send({ type: "file", file: { ...this.file(test), status: "running" } });
  }
  bucket(test, result) {
    return JSON.stringify([
      this.file(test).id,
      result.ancestorTitles || [],
      result.title,
      result.location || null,
    ]);
  }
  onTestCaseResult(test, result) {
    const k = this.bucket(test, result);
    const records = this.identities.get(k) || [];
    this.identities.set(k, records);
    const invocation = result.invocations || 1;
    let record;
    if (invocation <= 1) {
      record = { occurrence: records.length };
      records.push(record);
    } else {
      const candidates = records.filter(
        (item) =>
          item.invocation === invocation - 1 && item.status === "failed",
      );
      if (candidates.length !== 1) {
        // Duplicate generated names may also share a declaration location. The
        // file's final declaration-ordered results resolve that ambiguity.
        send({
          type: "notice",
          message:
            "Jest supplied ambiguous retry identities. Those retry updates are deferred until the file's final report.",
        });
        return;
      }
      record = candidates[0];
    }
    record.invocation = invocation;
    record.status = result.status;
    send({ type: "test", test: this.test(test, result, record.occurrence) });
  }
  onTestFileResult(test, result) {
    const file = this.file(test),
      seen = new Map();
    for (const item of result.testResults) {
      const k = this.bucket(test, item),
        n = seen.get(k) || 0;
      seen.set(k, n + 1);
      send({ type: "test", test: this.test(test, item, n) });
    }
    send({
      type: "file",
      file: {
        ...file,
        status: result.testExecError
          ? "error"
          : result.numFailingTests
            ? "failed"
            : "passed",
        duration: result.perfStats?.runtime ?? null,
        errors: result.testExecError ? [error(result.testExecError)] : [],
      },
    });
    for (const log of result.console || [])
      send({
        type: "log",
        record: {
          stream: "console",
          level: log.type,
          fileId: file.id,
          text: log.message,
          availability: "file-completion",
        },
      });
  }
  onRunComplete(_, result) {
    // Jest computes aggregate success (including coverage/reporter errors) only
    // after awaiting every onRunComplete callback. Read that same result object
    // on the next event-loop turn, without delaying Jest's reporter dispatcher.
    const completed = new Promise((resolve) =>
      setImmediate(() => {
        try {
          if (result.runExecError)
            send({ type: "error", error: error(result.runExecError) });
          send({
            type: "end",
            failed: !result.success,
            interrupted: result.wasInterrupted,
            watching: this.watch,
          });
        } finally {
          resolve();
        }
      }),
    );
    completions.add(completed);
    void completed.then(() => completions.delete(completed));
  }
};
// One-shot runCLI can return before the deferred reporter callback executes.
module.exports.flush = () => Promise.all([...completions]);
