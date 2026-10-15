import { createHash } from "node:crypto";
export const key = (...parts) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
const terminal = new Set(["passed", "failed", "skipped", "todo", "cancelled"]);
export function createState(info) {
  return {
    ...info,
    schemaVersion: 1,
    status: "starting",
    watching: false,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: null,
    tests: new Map(),
    files: new Map(),
    errors: [],
    notices: [],
    totalComplete: false,
    exitCode: null,
    signal: null,
  };
}
export function reduce(state, event) {
  if (
    state.endedAt &&
    event.type !== "exit" &&
    event.type !== "notice" &&
    event.type !== "error"
  )
    return;
  state.updatedAt = new Date().toISOString();
  if (event.type === "start") {
    state.status = "running";
    for (const file of event.files || [])
      state.files.set(file.id, {
        ...file,
        status: "queued",
        errors: [],
        duration: null,
      });
  }
  if (event.type === "file") {
    const old = state.files.get(event.file.id) || {
      errors: [],
      duration: null,
    };
    state.files.set(event.file.id, { ...old, ...event.file });
  }
  if (event.type === "test") {
    const old = state.tests.get(event.test.id);
    state.tests.set(event.test.id, {
      errors: [],
      retry: 0,
      duration: null,
      ...old,
      ...event.test,
    });
  }
  if (event.type === "error") {
    state.errors.push(event.error);
    if (state.endedAt) state.status = "error";
  }
  if (event.type === "notice" && !state.notices.includes(event.message))
    state.notices.push(event.message);
  if (event.type === "end") {
    state.totalComplete = [...state.files.values()].every(
      (f) => !["queued", "running"].includes(f.status),
    );
    state.watching = Boolean(event.watching);
    for (const test of state.tests.values())
      if (!terminal.has(test.status)) test.status = "cancelled";
    state.endedAt = state.updatedAt;
    const values = [...state.tests.values()];
    state.status = event.interrupted
      ? "interrupted"
      : state.errors.length ||
          [...state.files.values()].some((f) => f.errors?.length)
        ? "error"
        : values.some((t) => t.status === "failed") || event.failed
          ? "failed"
          : values.some((t) => t.status === "cancelled")
            ? "interrupted"
            : values.some((t) => t.status === "passed")
              ? "passed"
              : "empty";
  }
  if (event.type === "exit") {
    state.exitCode = event.code;
    state.signal = event.signal;
    state.watching = false;
    if (!state.endedAt) {
      if (
        !event.signal &&
        event.code !== 0 &&
        !state.errors.length &&
        ![...state.tests.values()].some((test) => test.status === "failed")
      )
        state.errors.push({
          message:
            "The runner exited before publishing a final report. Inspect Run output; results may be incomplete.",
        });
      reduce(state, { type: "end", interrupted: Boolean(event.signal) });
      state.totalComplete = false;
    }
    if (event.signal) state.status = "interrupted";
    else if (
      event.code !== 0 &&
      !["failed", "error", "interrupted"].includes(state.status)
    )
      state.status = "error";
  }
}
export function snapshot(state) {
  const tests = [...state.tests.values()];
  const counts = {
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    todo: 0,
    cancelled: 0,
    running: 0,
    queued: 0,
    retries: 0,
  };
  for (const test of tests) {
    if (test.status in counts) counts[test.status]++;
    if (test.status === "passed" && test.retry > 0) {
      counts.passed--;
      counts.flaky++;
    }
    counts.retries += test.retry || 0;
  }
  const groups = new Map();
  for (const test of tests) {
    if (!groups.has(test.fileId)) groups.set(test.fileId, []);
    groups.get(test.fileId).push(test);
  }
  const files = [...state.files.values()].map((file) => {
    const members = groups.get(file.id) || [];
    return {
      ...file,
      total: members.length,
      failed: members.filter((t) => t.status === "failed").length,
      completed: members.filter((t) => terminal.has(t.status)).length,
    };
  });
  const { tests: _, files: __, ...metadata } = state;
  return {
    ...metadata,
    ...counts,
    total: tests.length,
    completed: tests.filter((t) => terminal.has(t.status)).length,
    files,
    tests,
  };
}
export function plainError(error) {
  if (typeof error === "string")
    return { message: error.slice(0, 1024 * 1024) };
  const out = {};
  for (const field of [
    "name",
    "message",
    "stack",
    "diff",
    "actual",
    "expected",
  ]) {
    try {
      if (error?.[field] !== undefined)
        out[field] = String(error[field]).slice(0, 1024 * 1024);
    } catch {
      /* An error can contain non-serializable properties. */
    }
  }
  return Object.keys(out).length ? out : { message: String(error) };
}
