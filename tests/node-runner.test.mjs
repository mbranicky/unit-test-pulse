import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { readTestSource } from "../server/test-source.mjs";
import { discover } from "../server/environment.mjs";

const plugin = resolve(import.meta.dirname, "..");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(
  t,
  body = "import test from 'node:test'; test('passes',()=>{});",
) {
  const root = await mkdtemp(join(tmpdir(), "pulse-node-"));
  const state = await mkdtemp(join(tmpdir(), "pulse-node-state-"));
  t.after(() =>
    Promise.all(
      [root, state].map((path) => rm(path, { recursive: true, force: true })),
    ),
  );
  const file = join(root, "example.test.mjs");
  await writeFile(file, body);
  return { root, state, file };
}
function launch(
  t,
  f,
  args = [],
  { watch = false, env = {}, automatic = false } = {},
) {
  const proc = spawn(
    process.execPath,
    [
      join(plugin, "server/cli.mjs"),
      "run",
      "--project",
      f.root,
      "--state-dir",
      f.state,
      ...(automatic ? [] : ["--runner", "node"]),
      ...(watch ? ["--watch"] : []),
      "--",
      ...args,
    ],
    {
      cwd: f.root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "",
    closed = false;
  proc.stdout.on("data", (chunk) => (output += chunk));
  proc.stderr.on("data", (chunk) => (output += chunk));
  const done = new Promise((r) =>
    proc.once("close", (code, signal) => {
      closed = true;
      r({ code, signal, output });
    }),
  );
  t.after(async () => {
    if (!closed) {
      proc.kill("SIGTERM");
      await done;
    }
  });
  return {
    proc,
    done,
    get output() {
      return output;
    },
    get closed() {
      return closed;
    },
  };
}
async function runs(f) {
  try {
    return (
      await Promise.all(
        (await readdir(join(f.state, "runs"))).map(async (id) =>
          JSON.parse(
            await readFile(join(f.state, "runs", id, "summary.json"), "utf8"),
          ),
        ),
      )
    ).sort((a, b) => a.cycle - b.cycle);
  } catch {
    return [];
  }
}
async function until(command, predicate, f) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const result = await predicate();
    if (result) return result;
    if (command.closed) break;
    await pause(50);
  }
  throw new Error(
    `Expected Node telemetry was unavailable.\nLast results: ${JSON.stringify(await runs(f))}\n${command.output}`,
  );
}

test(
  "Node: live nested results, strict assertion details, duplicate titles, and honest file logs",
  { timeout: 30000 },
  async (t) => {
    const body = `import check, {describe,it} from 'node:test';
import assert from 'node:assert/strict';
describe('shopping cart',()=>{
  it('passes',()=>{console.log('stdout marker');console.error('stderr marker');assert.equal(2+2,4);});
  it('fails',()=>assert.deepEqual({value:1},{value:2}));
  it.skip('skipped',()=>{}); it.todo('later');
});
check('parent',async ctx=>{await ctx.test('nested child',()=>assert.ok(true));});
for(let i=0;i<2;i++) check('same title',()=>assert.ok(true));
check('slow',async()=>{await new Promise(r=>setTimeout(r,1200));});`;
    const f = await fixture(t, body),
      command = launch(t, f, ["example.test.mjs"]);
    const partial = await until(
      command,
      async () => {
        const [r] = await runs(f);
        return r?.passed > 0 && !r.endedAt ? r : false;
      },
      f,
    );
    assert.equal(partial.status, "running");
    const result = await command.done;
    assert.equal(result.code, 1, result.output);
    const [run] = await runs(f);
    assert.equal(run.runner, "node");
    assert.equal(run.runnerVersion, process.versions.node);
    assert.equal(run.total, 9);
    assert.equal(run.passed, 6);
    assert.equal(run.failed, 1);
    assert.equal(run.skipped, 1);
    assert.equal(run.todo, 1);
    assert.equal(run.totalComplete, true);
    assert.equal(run.files.length, 1);
    assert.equal(run.files[0].status, "failed");
    assert.ok(run.files[0].duration > 0);
    const failed = run.tests.find((t) => t.title === "fails");
    assert.deepEqual(failed.titlePath, ["shopping cart", "fails"]);
    assert.equal(failed.errors[0].name, "AssertionError");
    assert.match(failed.errors[0].stack, /example.test.mjs:5/);
    assert.match(failed.errors[0].actual, /value: 1/);
    assert.match(failed.errors[0].expected, /value: 2/);
    assert.equal(new Set(run.tests.map((t) => t.id)).size, 9);
    const child = run.tests.find((t) => t.title === "nested child");
    assert.deepEqual(child.titlePath, ["parent", "nested child"]);
    const source = await readTestSource(run, child.id, f.root);
    assert.match(source.text, /^ctx.test\('nested child'/);
    const failureSource = await readTestSource(run, failed.id, f.root);
    assert.match(failureSource.text, /^it\('fails'/);
    const records = (
      await readFile(join(f.state, "runs", run.id, "logs.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    for (const marker of ["stdout marker", "stderr marker"])
      assert.ok(
        records.some(
          (r) =>
            r.stream === "console" &&
            r.fileId === run.files[0].id &&
            r.text.includes(marker),
        ),
      );
    assert.ok(
      records.every((r) => !r.testId),
      "Node does not identify the test that owns stdout/stderr",
    );
    assert.equal(await readFile(f.file, "utf8"), body);
    assert.deepEqual(
      await readdir(f.root),
      ["example.test.mjs"],
      "monitoring adds no project files or dependencies",
    );
  },
);

test(
  "Node: ESM, CommonJS, TypeScript, callback tests, and assert-only files use the native runtime",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import {test} from 'node:test'; import assert from 'node:assert'; test('ESM callback',(t,done)=>{assert.strictEqual(1,1);done();});",
    );
    await writeFile(
      join(f.root, "common.test.cjs"),
      "const {it: example} = require('node:test'); const assert = require('node:assert/strict'); example('CommonJS',()=>assert.equal(2,2));",
    );
    await writeFile(
      join(f.root, "typed.test.ts"),
      "import check from 'node:test'; import assert from 'node:assert/strict'; const value: number = 3; check('TypeScript',()=>assert.equal(value,3));",
    );
    await writeFile(
      join(f.root, "plain.test.cjs"),
      "require('node:assert/strict').equal(4,4);",
    );
    assert.deepEqual(
      discover(f.root).map((r) => r.runner),
      ["node"],
    );
    const command = launch(
      t,
      f,
      [
        "example.test.mjs",
        "common.test.cjs",
        "typed.test.ts",
        "plain.test.cjs",
      ],
      { automatic: true },
    );
    const result = await command.done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.passed, 4);
    assert.equal(run.files.length, 4);
    assert.equal(run.totalComplete, true);
    const cjs = run.tests.find((t) => t.title === "CommonJS");
    assert.match(
      (await readTestSource(run, cjs.id, f.root)).text,
      /^example\('CommonJS'/,
    );
  },
);

test(
  "Node: existing reporters, destinations, preload settings and native selection are preserved",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import test from 'node:test'; import assert from 'node:assert/strict'; test('selected',()=>assert.equal(globalThis.pulsePreload,'preserved')); test('other',()=>assert.fail('must be filtered'));",
    );
    await writeFile(
      join(f.root, "preload.mjs"),
      "globalThis.pulsePreload='preserved';",
    );
    await writeFile(
      join(f.root, "custom reporter.mjs"),
      "export default async function* (events) {for await(const event of events) if(event.type==='test:pass') yield 'custom:'+event.data.name+'\\n';}",
    );
    const args = [
      "--test-reporter",
      "tap",
      "--test-reporter-destination",
      "stdout",
      "--test-reporter=./custom reporter.mjs",
      "--test-reporter-destination=custom.txt",
      "--test-name-pattern=selected",
      "example.test.mjs",
    ];
    const nativeEnv = {
      ...process.env,
      NODE_OPTIONS: '--import="./preload.mjs"',
    };
    delete nativeEnv.NODE_TEST_CONTEXT;
    delete nativeEnv.NODE_TEST_WORKER_ID;
    const native = spawn(process.execPath, ["--test", ...args], {
      cwd: f.root,
      env: nativeEnv,
      stdio: "ignore",
    });
    const nativeCode = await new Promise((r) => native.once("close", r));
    const original = await readFile(join(f.root, "custom.txt"), "utf8");
    await rm(join(f.root, "custom.txt"));
    const command = launch(t, f, args, {
      env: { NODE_OPTIONS: '--import="./preload.mjs"' },
    });
    const result = await command.done;
    assert.equal(result.code, nativeCode, result.output);
    assert.equal(result.code, 0);
    assert.match(result.output, /TAP version/);
    assert.equal(await readFile(join(f.root, "custom.txt"), "utf8"), original);
    const [run] = await runs(f);
    assert.equal(run.passed, 1);
    assert.equal(run.failed, 0);
  },
);

test(
  "Node: reporters inherited through NODE_OPTIONS retain their destination",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const command = launch(t, f, ["example.test.mjs"], {
      env: {
        NODE_OPTIONS:
          '--test-reporter=tap --test-reporter-destination="inherited output.txt"',
      },
    });
    const result = await command.done;
    assert.equal(result.code, 0, result.output);
    assert.match(
      await readFile(join(f.root, "inherited output.txt"), "utf8"),
      /TAP version/,
    );
    assert.equal((await runs(f))[0].passed, 1);
  },
);

for (const [name, body, marker] of [
  ["import", "throw Error('import failure marker')", /import failure marker/],
  [
    "suite hook",
    "import {describe,it,before} from 'node:test'; describe('suite',()=>{before(()=>{throw Error('hook failure marker')});it('child',()=>{});});",
    /hook failure marker/,
  ],
  [
    "teardown",
    "import {test,after} from 'node:test'; test('passes',()=>{}); after(()=>{throw Error('teardown failure marker')});",
    /teardown failure marker/,
  ],
])
  test(
    `Node: ${name} failures remain visible`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, body),
        command = launch(t, f, ["example.test.mjs"]);
      const result = await command.done;
      assert.equal(result.code, 1, result.output);
      const [run] = await runs(f);
      assert.notEqual(run.status, "passed");
      const output = await readFile(
        join(f.state, "runs", run.id, "logs.jsonl"),
        "utf8",
      );
      assert.match(
        JSON.stringify(run.files) + JSON.stringify(run.errors) + output,
        marker,
      );
    },
  );

test(
  "Node: watch cycles are separate and only re-executed files belong to the new cycle",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await writeFile(
      join(f.root, "other.test.mjs"),
      "import test from 'node:test'; test('unchanged file',()=>{});",
    );
    const command = launch(t, f, [], { watch: true });
    const first = await until(
      command,
      async () => {
        const [r] = await runs(f);
        return r?.endedAt && r.watching ? r : false;
      },
      f,
    );
    assert.equal(first.passed, 2);
    await pause(300);
    await writeFile(
      f.file,
      "import test from 'node:test'; test('changed file',()=>{});\n",
    );
    const second = await until(
      command,
      async () => {
        const rs = await runs(f);
        return rs[1]?.endedAt ? rs[1] : false;
      },
      f,
    );
    assert.equal(second.cycle, 2);
    assert.equal(second.sessionId, first.sessionId);
    assert.notEqual(second.id, first.id);
    assert.equal(second.total, 1);
    assert.equal(second.tests[0].title, "changed file");
    assert.equal(second.watching, true);
    command.proc.kill("SIGTERM");
    await command.done;
    assert.equal((await runs(f)).at(-1).watching, false);
  },
);

test(
  "Node: concurrent commands and interruption preserve independent partial results",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import test from 'node:test'; test('quick',()=>{});test('slow',async()=>{await new Promise(r=>setTimeout(r,1500));});",
    );
    const a = launch(t, f),
      b = launch(t, f);
    await until(
      a,
      async () => {
        const rs = await runs(f);
        return rs.length === 2 && rs.every((r) => r.passed === 1 && !r.endedAt);
      },
      f,
    );
    a.proc.kill("SIGTERM");
    const [ar, br] = await Promise.all([a.done, b.done]);
    assert.notEqual(ar.code, 0);
    assert.equal(br.code, 0, br.output);
    const rs = await runs(f);
    assert.equal(new Set(rs.map((r) => r.sessionId)).size, 2);
    assert.ok(rs.some((r) => r.status === "interrupted" && r.passed === 1));
    assert.ok(rs.some((r) => r.status === "passed" && r.passed === 2));
  },
);

test(
  "Node: skip/todo-only and unmatched name selections do not imply successful verification",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import test from 'node:test';test.skip('skip',()=>{});test.todo('todo');",
    );
    const command = launch(t, f),
      result = await command.done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.status, "empty");
    assert.equal(run.skipped, 1);
    assert.equal(run.todo, 1);
    const filtered = launch(t, f, [
      "--test-name-pattern=not-present",
      "example.test.mjs",
    ]);
    const filteredResult = await filtered.done;
    assert.equal(filteredResult.code, 0, filteredResult.output);
    assert.ok((await runs(f)).every((r) => r.passed === 0));
  },
);

test(
  "Node: invalid reporter options fail without a false successful run",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      command = launch(t, f, [
        "--test-reporter=tap",
        "--test-reporter=spec",
        "example.test.mjs",
      ]);
    const result = await command.done;
    assert.equal(result.code, 1, result.output);
    const [run] = await runs(f);
    assert.equal(run.status, "error");
    assert.equal(run.passed, 0);
    assert.match(JSON.stringify(run.errors), /destination/);
  },
);

test(
  "Node: single reporters without explicit destinations and native no-isolation mode work",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      command = launch(t, f, [
        "--test-reporter",
        "tap",
        "--experimental-test-isolation=none",
        "example.test.mjs",
      ]);
    const result = await command.done;
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /TAP version/);
    const [run] = await runs(f);
    assert.equal(run.passed, 1);
    assert.equal(run.totalComplete, true);
    assert.equal(run.status, "passed");
  },
);

test(
  "Node: timeouts and cancelled children remain unsuccessful",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import test from 'node:test'; test('timeout',{timeout:30},async()=>{await new Promise(r=>setTimeout(r,100));});test('parent',{timeout:20},async t=>{await t.test('cancelled child',async()=>{await new Promise(r=>setTimeout(r,100));});});",
    );
    const command = launch(t, f),
      result = await command.done;
    assert.equal(result.code, 1, result.output);
    const [run] = await runs(f);
    assert.equal(
      run.tests.find((t) => t.title === "timeout").status,
      "cancelled",
    );
    assert.equal(
      run.tests.find((t) => t.title === "cancelled child").status,
      "cancelled",
    );
    assert.notEqual(run.status, "passed");
  },
);

test(
  "Node: an empty project completes with zero executed tests",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await rm(f.file);
    const command = launch(t, f),
      result = await command.done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.status, "empty");
    assert.equal(run.total, 0);
    assert.equal(run.totalComplete, true);
  },
);
