import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import ts from "typescript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
// Use the real RPC contracts and schemas, panel, controls, query lifecycle,
// file cards and server handler. Only host widgets and persisted storage are replaced.
const contracts = load("../shared/rpc.ts", {
  "@getpaseo/plugin": { defineRpc: (contract) => contract },
});

function load(path, overrides) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      setInterval,
      clearInterval,
      require(name) {
        return Object.hasOwn(overrides, name) ? overrides[name] : require(name);
      },
    },
  );
  return module.exports;
}
const native = {
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  Pressable: "Pressable",
  ActivityIndicator: "ActivityIndicator",
};
const host = {
  ScrollView: "ScrollView",
  Icon: "Icon",
  copyText: async () => {},
  useToast: () => ({ show() {}, error() {} }),
};
const ui = load("../client/ui.tsx", {
  "react-native": native,
  "@getpaseo/plugin/client/react-native": host,
});
const { FileGroup } = load("../client/file-group.tsx", {
  "react-native": native,
  "@getpaseo/plugin/client/react-native": host,
  "./ui": ui,
  "./test-row": { TestRow: "TestRow" },
});

function fixture(count = 425, singleFile = false) {
  const files = Array.from({ length: singleFile ? 1 : count }, (_, i) => ({
    id: `file-${i}`,
    file: `/project/spec-${i}.test.ts`,
    project: "",
    status: "passed",
    total: singleFile ? count : 1,
    completed: singleFile ? count : 1,
    failed: 0,
    errors: [],
    duration: 1,
  }));
  const tests = Array.from({ length: count }, (_, i) => ({
    id: `test-${i}`,
    fileId: singleFile ? "file-0" : `file-${i}`,
    file: files[singleFile ? 0 : i].file,
    project: "",
    duration: null,
    title: `case-${i}`,
    titlePath: [`case-${i}`],
    status: "passed",
    retry: 0,
    errors: [],
  }));
  return {
    id: "run-1",
    schemaVersion: 1,
    sessionId: "session-1",
    cycle: 1,
    runner: "node",
    runnerVersion: process.versions.node,
    workspaceRoot: "/project",
    mode: "run",
    watching: false,
    totalComplete: true,
    exitCode: 0,
    signal: null,
    total: count,
    completed: count,
    passed: count,
    failed: 0,
    flaky: 0,
    skipped: 0,
    todo: 0,
    cancelled: 0,
    running: 0,
    queued: 0,
    retries: 0,
    projectRoot: "/project",
    status: "passed",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    tests,
    files,
    errors: [],
    notices: [],
  };
}
async function render(t, run = fixture()) {
  const state = { runs: [run] },
    requests = [],
    handlers = new Map();
  const contribute = load("../index.server.ts", {
    "./shared/rpc": contracts,
    "./server/store.mjs": {
      listRuns: () => ({ runs: state.runs, notices: [] }),
      readRun: (id) => state.runs.find((r) => r.id === id),
    },
    "./server/source.mjs": {},
    "./server/test-source.mjs": {},
    "./server/report.mjs": {},
    "./server/runtime": {
      installHelper: async () => "/helper",
      findPluginDirectory: async () => "/plugin",
    },
    "./server/skill.mjs": {},
  }).default;
  contribute({
    handle: (contract, handler) => handlers.set(contract, handler),
  });
  const rpc = async (input) => {
    requests.push({ ...input });
    const result = await handlers.get(contracts.dashboard)(
      contracts.dashboard.input.parse(input),
      {
        paseo: {
          workspaces: {
            ref: () => ({
              refresh: async () => ({ workspaceDirectory: "/project" }),
            }),
          },
        },
      },
    );
    return contracts.dashboard.output.parse(result);
  };
  const { PulsePanel } = load("../client/panel.tsx", {
    "react-native": native,
    "@getpaseo/plugin/client/react-native": host,
    "@getpaseo/plugin/client": {
      useRpc: (contract) =>
        contract === contracts.dashboard ? rpc : async () => ({}),
    },
    "../shared/rpc": contracts,
    "./ui": ui,
    "./file-group": { FileGroup },
    "./setup": { AgentSetup: () => null },
    "./run-summary": { RunSummary: () => null },
    "./detail-modal": { DetailModal: () => null },
    "./source-preview": {},
    "./log-viewer": {},
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(PulsePanel, {
          theme: { colors: {} },
          host: { id: "host-1" },
          workspaceId: "workspace-1",
          layout: {},
          onSettings() {},
        }),
      ),
    );
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    queryClient.clear();
  });
  async function settle(
    predicate = () =>
      queryClient.isFetching() === 0 &&
      renderer.root.findAllByType(FileGroup).length > 0,
  ) {
    for (let i = 0; i < 100; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      if (predicate()) return;
    }
    assert.fail("Panel did not settle after its dashboard response");
  }
  await settle();
  const buttons = (label) =>
    renderer.root
      .findAllByType("Pressable")
      .filter((n) => n.props.accessibilityLabel === label);
  return {
    state,
    requests,
    queryClient,
    renderer,
    settle,
    buttons,
    footer: () =>
      renderer.root
        .findAllByType("Text")
        .find((node) =>
          node.children.some(
            (child) => typeof child === "string" && child.includes("matching"),
          ),
        )
        ?.children.join(""),
    files: () =>
      renderer.root.findAllByType(FileGroup).map((n) => n.props.file.id),
    async click(label) {
      const button = buttons(label)[0];
      assert.ok(button, `Missing button ${label}`);
      await act(async () => {
        button.props.onPress({ stopPropagation() {} });
      });
      await settle();
    },
  };
}

test("Next and Previous change the visible suite cards through the real dashboard handler", async (t) => {
  const h = await render(t, fixture(62));
  assert.equal(h.files().length, 25);
  assert.equal(h.footer(), "62 matching files · page 1");
  assert.equal(h.files()[0], "file-0");
  assert.equal(h.buttons("Previous").length, 0);
  await h.click("Next");
  assert.equal(h.requests.at(-1).offset, 25);
  assert.equal(h.files().length, 25);
  assert.equal(h.files()[0], "file-25");
  await h.click("Next");
  assert.equal(h.files().length, 12);
  assert.equal(h.files()[0], "file-50");
  assert.equal(h.buttons("Next").length, 0);
  await h.click("Previous");
  assert.equal(h.files()[0], "file-25");
  await h.click("Previous");
  assert.equal(h.files()[0], "file-0");
  assert.equal(h.buttons("Previous").length, 0);
});

test("paging within one expanded file changes its actual test rows and preserves file scope", async (t) => {
  const h = await render(t, fixture(425, true));
  await h.click("Expand spec-0.test.ts");
  await h.click("Show 425 tests in this file");
  const rows = () =>
    h.renderer.root.findAllByType("TestRow").map((node) => node.props.test.id);
  assert.equal(h.requests.at(-1).fileId, "file-0");
  assert.equal(rows()[0], "test-0");
  assert.equal(rows().length, 200);
  assert.equal(h.footer(), "425 matching tests · page 1");
  await h.click("Next");
  assert.equal(h.requests.at(-1).fileId, "file-0");
  assert.equal(rows()[0], "test-200");
  await h.click("Next");
  assert.equal(rows()[0], "test-400");
  assert.equal(rows().length, 25);
  assert.equal(h.buttons("Next").length, 0);
  await h.click("Previous");
  assert.equal(rows()[0], "test-200");
});

test("filtering and searching from later pages restart at the first matching page", async (t) => {
  const run = fixture();
  for (let i = 0; i < 25; i++) {
    run.tests[i].status = "failed";
    run.files[i].failed = 1;
    run.files[i].status = "failed";
  }
  const h = await render(t, run);
  await h.click("Next");
  await h.click("Next");
  await h.click("Failed");
  assert.equal(h.requests.at(-1).offset, 0);
  assert.equal(h.files().length, 25);
  assert.equal(h.buttons("Previous").length, 0);
  assert.equal(h.buttons("Next").length, 0);
  await h.click("All");
  await h.click("Next");
  await act(async () =>
    h.renderer.root.findByType("TextInput").props.onChangeText("case-424"),
  );
  await h.settle();
  assert.equal(h.requests.at(-1).offset, 0);
  assert.deepEqual(h.files(), ["file-424"]);
});

test("a new latest run resets the page instead of keeping an invalid old offset", async (t) => {
  const h = await render(t);
  await h.click("Next");
  await h.click("Next");
  const next = { ...fixture(3), id: "run-2" };
  h.state.runs.unshift(next);
  await act(async () => h.queryClient.invalidateQueries());
  await h.settle(
    () =>
      h.requests.at(-1).offset === 0 &&
      h.files().length === 3 &&
      h.queryClient.isFetching() === 0,
  );
  assert.deepEqual(h.files(), ["file-0", "file-1", "file-2"]);
  assert.equal(h.buttons("Previous").length, 0);
});

test("selecting a historical run from a later page starts that run on page one", async (t) => {
  const h = await render(t);
  h.state.runs.push({ ...fixture(4), id: "older-run" });
  await act(async () => h.queryClient.invalidateQueries());
  await h.settle();
  await h.click("Next");
  await h.click("Recent runs");
  const older = h.renderer.root
    .findAllByType("Pressable")
    .find(
      (node) =>
        !node.props.accessibilityLabel &&
        node.props.accessibilityState?.selected === false,
    );
  assert.ok(older);
  await act(async () => older.props.onPress());
  await h.settle();
  assert.equal(h.requests.at(-1).runId, "older-run");
  assert.equal(h.requests.at(-1).offset, 0);
  assert.equal(h.files().length, 4);
  assert.equal(h.buttons("Previous").length, 0);
});

test("file failures without test records remain visible on the first page", async (t) => {
  const run = fixture();
  run.files.push({
    duration: null,
    id: "import-error",
    file: "/project/broken.test.ts",
    project: "",
    status: "error",
    total: 0,
    completed: 0,
    failed: 0,
    errors: [{ message: "Could not import test file" }],
  });
  const h = await render(t, run);
  assert.ok(h.files().includes("import-error"));
  await h.click("Next");
  assert.equal(h.files().length, 25);
  assert.equal(h.files().includes("import-error"), false);
  await h.click("Previous");
  await h.click("Failed");
  assert.deepEqual(h.files(), ["import-error"]);
});

test("no search matches show an empty list without pager actions", async (t) => {
  const h = await render(t);
  await h.click("Next");
  await act(async () =>
    h.renderer.root.findByType("TextInput").props.onChangeText("no-such-test"),
  );
  await h.settle(
    () => h.queryClient.isFetching() === 0 && h.files().length === 0,
  );
  assert.equal(h.requests.at(-1).offset, 0);
  assert.equal(h.buttons("Next").length, 0);
  assert.equal(h.buttons("Previous").length, 0);
});

test("file pages stay at 25 cards regardless of suite sizes, with only the last page shorter", async (t) => {
  const run = fixture(62);
  run.tests = [];
  for (let fileIndex = 0; fileIndex < run.files.length; fileIndex++) {
    const file = run.files[fileIndex];
    const count = fileIndex === 0 ? 350 : ((fileIndex % 7) + 1) * 3;
    file.total = file.completed = count;
    for (let i = 0; i < count; i++)
      run.tests.push({
        id: `test-${fileIndex}-${i}`,
        fileId: file.id,
        file: file.file,
        project: "",
        duration: null,
        title: `case-${fileIndex}-${i}`,
        titlePath: [`case-${fileIndex}-${i}`],
        status: "passed",
        retry: 0,
        errors: [],
      });
  }
  const h = await render(t, run);
  const seen = [];
  for (const count of [25, 25, 12]) {
    assert.equal(h.files().length, count);
    seen.push(...h.files());
    if (seen.length < 62) await h.click("Next");
  }
  assert.deepEqual(
    seen,
    run.files.map((file) => file.id),
  );
  assert.equal(h.buttons("Next").length, 0);
});

test("an exact multiple of the file page size does not produce an extra page", async (t) => {
  const h = await render(t, fixture(50));
  assert.equal(h.files().length, 25);
  await h.click("Next");
  assert.equal(h.files().length, 25);
  assert.equal(h.footer(), "50 matching files · page 2");
  assert.equal(h.buttons("Next").length, 0);
  await h.click("Previous");
  assert.equal(h.files()[0], "file-0");
});

test("zero-test import failures are paged as files and remain reachable", async (t) => {
  const run = fixture(61);
  run.tests = [];
  for (const file of run.files) {
    file.total = file.completed = 0;
    file.status = "error";
    file.errors = [{ message: "Import failed before tests were collected" }];
  }
  const h = await render(t, run);
  assert.equal(h.files().length, 25);
  assert.equal(h.footer(), "61 matching files · page 1");
  await h.click("Next");
  assert.equal(h.files().length, 25);
  await h.click("Next");
  assert.equal(h.files().length, 11);
  assert.equal(h.files()[0], "file-50");
  assert.equal(h.buttons("Next").length, 0);
});
