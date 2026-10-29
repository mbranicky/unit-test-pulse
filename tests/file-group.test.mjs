import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

// Exercise the real component and React hook lifecycle, replacing only host UI
// primitives and child rows so the test can run without the Paseo native host.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const module = { exports: {} };
const code = ts.transpileModule(
  readFileSync(new URL("../client/file-group.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
vm.runInNewContext(code, {
  module,
  exports: module.exports,
  require(name) {
    if (name === "react-native")
      return { Pressable: "Pressable", Text: "Text", View: "View" };
    if (name === "@getpaseo/plugin/client/react-native")
      return { Icon: "Icon" };
    if (name === "./ui")
      return {
        Action: "Action",
        basename: (file) => file.split("/").at(-1),
        tone: () => "#000000",
      };
    if (name === "./test-row") return { TestRow: "TestRow" };
    return require(name);
  },
});
const { FileGroup } = module.exports;
const file = {
  id: "file-1",
  file: "/project/tests/cart.test.ts",
  project: "",
  status: "queued",
  total: 43,
  completed: 0,
  failed: 0,
  duration: null,
  errors: [],
};
const props = {
  file,
  tests: [],
  root: "/project",
  colors: {},
  onSource() {},
  onDetails() {},
  onTest() {},
  onLogs() {},
  onLoad() {},
};
async function render(t, initial = {}) {
  let renderer;
  await act(() => {
    renderer = TestRenderer.create(
      React.createElement(FileGroup, { ...props, ...initial }),
    );
  });
  t.after(async () => {
    await act(() => renderer.unmount());
  });
  return {
    get expanded() {
      return renderer.root.findAllByType("Pressable")[0].props
        .accessibilityState.expanded;
    },
    labels() {
      return renderer.root
        .findAllByType("Action")
        .map((node) => node.props.label);
    },
    rows() {
      return renderer.root.findAllByType("TestRow");
    },
    async update(changes) {
      await act(() =>
        renderer.update(
          React.createElement(FileGroup, { ...props, ...changes }),
        ),
      );
    },
    async toggle() {
      await act(() =>
        renderer.root.findAllByType("Pressable")[0].props.onPress(),
      );
    },
  };
}

test("file groups: non-failing files start collapsed, including unloaded large-suite pages", async (t) => {
  for (const status of [
    "queued",
    "running",
    "passed",
    "skipped",
    "todo",
    "cancelled",
  ]) {
    await t.test(status, async (t) => {
      const view = await render(t, { file: { ...file, status } });
      assert.equal(view.expanded, false);
      assert.deepEqual(view.labels(), []);
    });
  }
});

test("file groups: initial assertion failures and file errors open their details", async (t) => {
  for (const failure of [
    { failed: 1 },
    { status: "error", errors: [{ message: "setup failed" }] },
  ]) {
    await t.test(JSON.stringify(failure), async (t) => {
      const view = await render(t, { file: { ...file, ...failure } });
      assert.equal(view.expanded, true);
      assert.ok(view.labels().includes("Show 43 tests in this file"));
    });
  }
});

test("file groups: a live failure opens a mounted file and recovery collapses it", async (t) => {
  const view = await render(t);
  assert.equal(view.expanded, false);
  await view.update({ file: { ...file, status: "running" } });
  assert.equal(view.expanded, false);
  await view.update({ file: { ...file, status: "failed", failed: 1 } });
  assert.equal(view.expanded, true);
  await view.update({ file: { ...file, status: "passed", completed: 43 } });
  assert.equal(view.expanded, false);
});

test("file groups: manual expansion survives progress updates and exposes loaded tests", async (t) => {
  const tests = [{ id: "test-1", title: "adds items", status: "passed" }];
  const view = await render(t, { tests });
  await view.toggle();
  assert.equal(view.expanded, true);
  assert.equal(view.rows().length, 1);
  await view.update({
    file: { ...file, status: "running", completed: 1 },
    tests,
  });
  assert.equal(view.expanded, true);
  await view.update({
    file: { ...file, status: "passed", completed: 43 },
    tests,
  });
  assert.equal(view.expanded, true);
  await view.toggle();
  assert.equal(view.expanded, false);
  await view.update({
    file: { ...file, status: "passed", completed: 43 },
    tests,
  });
  assert.equal(view.expanded, false);
});

test("file groups: manual collapse of a failure lasts until the next failure transition", async (t) => {
  const failed = { ...file, status: "failed", failed: 1 };
  const view = await render(t, { file: failed });
  await view.toggle();
  await view.update({ file: { ...failed, completed: 10 } });
  assert.equal(view.expanded, false);
  await view.update({ file: { ...file, status: "running" } });
  await view.update({ file: failed });
  assert.equal(view.expanded, true);
});
