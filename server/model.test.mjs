import test from "node:test";
import assert from "node:assert/strict";
import { createState, reduce, snapshot } from "./model.mjs";
const info = {
  id: "a".repeat(32),
  runner: "vitest",
  projectRoot: "/tmp/project",
};
const sample = {
  id: "test1",
  fileId: "file1",
  file: "/tmp/project/example.test.ts",
  title: "sample",
  titlePath: ["sample"],
  status: "passed",
  retry: 0,
};
test("duplicate result events are idempotent and retries count once", () => {
  const state = createState(info);
  reduce(state, { type: "test", test: { ...sample, retry: 2 } });
  reduce(state, { type: "test", test: { ...sample, retry: 2 } });
  const run = snapshot(state);
  assert.equal(run.total, 1);
  assert.equal(run.flaky, 1);
  assert.equal(run.passed, 0);
  assert.equal(run.retries, 2);
});
test("skip/todo-only cycles are not successful verification", () => {
  const state = createState(info);
  reduce(state, { type: "test", test: { ...sample, status: "todo" } });
  reduce(state, { type: "end" });
  assert.equal(snapshot(state).status, "empty");
});
test("exit failures override assertion success", () => {
  const state = createState(info);
  reduce(state, { type: "test", test: sample });
  reduce(state, { type: "end" });
  reduce(state, { type: "exit", code: 1, signal: null });
  assert.equal(snapshot(state).status, "error");
  assert.equal(snapshot(state).passed, 1);
});
test("startup failures remain errors rather than a completed or successful run", () => {
  const state = createState(info);
  reduce(state, { type: "error", error: { message: "config import failed" } });
  reduce(state, { type: "exit", code: 1, signal: null });
  assert.equal(snapshot(state).status, "error");
});
test("bail leaves queued tests cancelled and late results cannot mutate a completed cycle", () => {
  const state = createState(info);
  reduce(state, { type: "test", test: { ...sample, status: "queued" } });
  reduce(state, { type: "end" });
  reduce(state, { type: "test", test: sample });
  assert.equal(snapshot(state).status, "interrupted");
  assert.equal(snapshot(state).cancelled, 1);
});
test("parallel files retain independent tests and large runs summarize without quadratic file scans", () => {
  const state = createState(info);
  for (let n = 0; n < 10000; n++) {
    reduce(state, {
      type: "file",
      file: { id: `f${n}`, file: `${n}.ts`, status: "passed" },
    });
    reduce(state, {
      type: "test",
      test: { ...sample, id: `t${n}`, fileId: `f${n}` },
    });
  }
  const run = snapshot(state);
  assert.equal(run.files.length, 10000);
  assert.equal(run.total, 10000);
  assert.equal(run.files[9999].completed, 1);
});

test("an adapter can explicitly mark an otherwise finished collection incomplete", () => {
  const state = createState(info);
  reduce(state, { type: "test", test: sample });
  reduce(state, { type: "end", complete: false });
  assert.equal(snapshot(state).totalComplete, false);
  assert.equal(snapshot(state).passed, 1);
});
