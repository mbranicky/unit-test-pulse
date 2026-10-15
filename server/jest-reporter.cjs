const { createHash } = require("node:crypto");
const key = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
const send = require("./channel.cjs");
const error = (value) => ({
  message: String(value?.message || value || "").slice(0, 1024 * 1024),
  ...(value?.stack ? { stack: String(value.stack).slice(0, 1024 * 1024) } : {}),
});
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
    const k = JSON.stringify([file.id, titles]);
    const n = occurrence ?? (this.identities.get(k) || 0);
    return {
      id: key(file.id, titles, n),
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
  onTestCaseResult(test, result) {
    const info = this.test(test, result);
    send({ type: "test", test: info });
    const k = JSON.stringify([info.fileId, info.titlePath]);
    this.identities.set(k, (this.identities.get(k) || 0) + 1);
  }
  onTestFileResult(test, result) {
    const file = this.file(test),
      seen = new Map();
    for (const item of result.testResults) {
      const k = JSON.stringify(item.ancestorTitles.concat(item.title)),
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
    if (result.runExecError)
      send({ type: "error", error: error(result.runExecError) });
    send({
      type: "end",
      failed: !result.success,
      interrupted: result.wasInterrupted,
      watching: this.watch,
    });
  }
};
