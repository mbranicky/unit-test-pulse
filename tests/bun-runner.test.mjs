import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { readTestSource } from "../server/test-source.mjs";
import {
  captureProcess,
  createGate,
  readRuns,
  waitForRelease,
  waitForTelemetry,
} from "./support/telemetry.mjs";
const plugin = resolve(import.meta.dirname, "..");
const bun = join(plugin, "node_modules/bun/bin/bun.exe");
async function fixture(
  t,
  body = "import {test} from 'bun:test';test('passes',()=>{});",
) {
  const root = await mkdtemp(join(tmpdir(), "pulse-bun-"));
  const state = await mkdtemp(join(tmpdir(), "pulse-bun-state-"));
  const commands = [];
  const file = join(root, "example.test.ts");
  t.after(async () => {
    await Promise.all(commands.map((c) => c.stop()));
    await Promise.all(
      [root, state].map((p) => rm(p, { recursive: true, force: true })),
    );
  });
  await writeFile(file, body);
  return { root, state, file, commands };
}
function launch(
  f,
  args = [],
  { watch = false, native = false, gated = false, env = {} } = {},
) {
  const gate = gated ? createGate(f.state) : null;
  const proc = spawn(
    native ? bun : process.execPath,
    native
      ? ["test", ...args]
      : [
          join(plugin, "server/cli.mjs"),
          "run",
          "--project",
          f.root,
          "--state-dir",
          f.state,
          "--runner",
          "bun",
          ...(watch ? ["--watch"] : []),
          "--",
          ...args,
        ],
    {
      cwd: f.root,
      env: {
        ...process.env,
        UNIT_TEST_PULSE_BUN_BIN: bun,
        ...env,
        ...(gate ? { UNIT_TEST_PULSE_TEST_GATE: gate.path } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const command = captureProcess(proc);
  command.release = () => gate?.release();
  f.commands.push(command);
  return command;
}
const runs = (f) => readRuns(f.state);
const until = (f, command, predicate) =>
  waitForTelemetry(predicate, {
    commands: Array.isArray(command) ? command : [command],
    snapshot: () => runs(f),
  });
const logs = async (f, run) =>
  (await readFile(join(f.state, "runs", run.id, "logs.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);

test(
  "Bun: live nested results, retries, skip/todo, duplicate identities, source and honest diagnostics",
  { timeout: 30000 },
  async (t) => {
    const body = `import {describe,test,expect} from 'bun:test';
describe('cart',()=>{
 test('passes',()=>{console.log('stdout marker');console.error('stderr marker');expect(1).toBe(1)});
 test('fails',()=>expect({value:1}).toEqual({value:2}));
 let n=0;test('retry pass',()=>expect(++n).toBe(2),{retry:1});
 test.skip('skip',()=>{});test.todo('later');
 test('same',()=>{});test('same',()=>{});
 test('held',${waitForRelease.toString()});
});`;
    const f = await fixture(t, body),
      command = launch(f, [], { gated: true });
    const partial = await until(f, command, async () => {
      const [r] = await runs(f);
      return r?.passed > 0 && !r.endedAt ? r : false;
    });
    assert.equal(partial.status, "running");
    await command.release();
    const result = await command.done;
    assert.equal(result.code, 1, result.output);
    const [run] = await runs(f);
    assert.equal(run.runner, "bun");
    assert.equal(run.runnerVersion, "1.4.3");
    assert.equal(run.total, 8);
    assert.equal(run.passed, 4);
    assert.equal(run.failed, 1);
    assert.equal(run.flaky, 1);
    assert.equal(run.skipped, 1);
    assert.equal(run.todo, 1);
    assert.equal(run.totalComplete, true);
    assert.equal(run.files[0].status, "failed");
    assert.equal(new Set(run.tests.map((t) => t.id)).size, 8);
    const failed = run.tests.find((t) => t.title === "fails");
    assert.deepEqual(failed.titlePath, ["cart", "fails"]);
    assert.equal(failed.location.line, 4);
    assert.match(
      (await readTestSource(run, failed.id, f.root)).text,
      /^test\('fails'/,
    );
    const records = await logs(f, run);
    for (const marker of [
      "stdout marker",
      "stderr marker",
      "Expected",
      "Received",
    ])
      assert.ok(
        records.some((r) => r.text.includes(marker)),
        marker,
      );
    assert.ok(
      records.every((r) => !r.testId && !r.fileId),
      "Inspector logs have no owning test or file identity",
    );
    assert.equal(await readFile(f.file, "utf8"), body);
    assert.deepEqual(await readdir(f.root), ["example.test.ts"]);
    const held = run.tests.find((t) => t.title === "held");
    assert.ok(
      held.duration < 30000 && held.duration > 0,
      "Bun reports nanoseconds; panel uses milliseconds",
    );
  },
);

test(
  "Bun: native configuration, environment, preloads, selection, and JUnit output are preserved",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import {test,expect} from 'bun:test';test('selected',()=>{expect(globalThis.fixtureValue).toBe(42);expect(process.env.PULSE_FIXTURE).toBe('preserved')});test('other',()=>{throw Error('not selected')});",
    );
    await writeFile(join(f.root, "setup.ts"), "globalThis.fixtureValue=42;");
    await writeFile(join(f.root, ".env.test"), "PULSE_FIXTURE=preserved\n");
    const config =
      '[test]\npreload=["./setup.ts"]\n[test.reporter]\njunit="./native-report.xml"\n';
    await writeFile(join(f.root, "bunfig.toml"), config);
    const args = ["--test-name-pattern", "selected"];
    const baseline = await launch(f, args, { native: true }).done;
    assert.equal(baseline.code, 0, baseline.output);
    const original = await readFile(join(f.root, "native-report.xml"), "utf8");
    await rm(join(f.root, "native-report.xml"));
    const result = await launch(f, args).done;
    assert.equal(result.code, baseline.code, result.output);
    const current = await readFile(join(f.root, "native-report.xml"), "utf8");
    assert.match(original, /selected/);
    assert.match(current, /selected/);
    assert.doesNotMatch(current, /not selected/);
    const [run] = await runs(f);
    assert.equal(run.status, "passed");
    assert.equal(run.total, 1);
    assert.equal(run.totalComplete, true);
    assert.equal(await readFile(join(f.root, "bunfig.toml"), "utf8"), config);
  },
);

test(
  "Bun: CommonJS, TSX, imported aliases and namespace source declarations",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import {test as check,describe as group} from 'bun:test';group('alias',()=>check('typed',()=>{const n:number=1;if(n!==1)throw Error('wrong')}));",
    );
    await writeFile(
      join(f.root, "common.test.cjs"),
      "const {it:check}=require('bun:test');check('CommonJS',()=>{});",
    );
    await writeFile(
      join(f.root, "view.test.tsx"),
      "import * as b from 'bun:test';b.it('TSX',()=>{const element=<div/>;b.expect(element).toBeDefined()});",
    );
    await writeFile(
      join(f.root, "jsx.ts"),
      "export function jsx(type,props){return {type,props}};export const jsxs=jsx;",
    );
    await writeFile(
      join(f.root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "react",
          jsxFactory: "Object",
          jsxFragmentFactory: "Object",
        },
      }),
    );
    const result = await launch(f).done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.passed, 3, JSON.stringify({ run, output: result.output }));
    assert.equal(run.files.length, 3);
    for (const [title, pattern] of [
      ["typed", /^check\('typed'/],
      ["CommonJS", /^check\('CommonJS'/],
      ["TSX", /^b.it\('TSX'/],
    ])
      assert.match(
        (
          await readTestSource(
            run,
            run.tests.find((t) => t.title === title).id,
            f.root,
          )
        ).text,
        pattern,
      );
  },
);

for (const hook of ["beforeAll", "afterAll"])
  test(
    `Bun: ${hook} errors remain unsuccessful`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        `import {test,${hook}} from 'bun:test';${hook}(()=>{throw Error('${hook} marker')});test('assertion',()=>{});`,
      );
      const baseline = await launch(f, [], { native: true }).done,
        result = await launch(f).done;
      assert.equal(result.code, baseline.code, result.output);
      assert.notEqual(result.code, 0);
      const [run] = await runs(f);
      assert.ok(["error", "failed"].includes(run.status));
      assert.ok(
        (await logs(f, run)).some((r) => r.text.includes(hook + " marker")),
      );
      if (hook === "afterAll") assert.equal(run.passed, 1);
    },
  );

test(
  "Bun: concurrent assertions keep identities and leave diagnostics unassigned",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import {test,expect} from 'bun:test';test.concurrent('one',async()=>{console.log('one output');await Bun.sleep(20);expect(1).toBe(2)});test.concurrent('two',async()=>{console.log('two output');await Bun.sleep(10);expect(2).toBe(2)});",
    );
    const result = await launch(f).done;
    assert.equal(result.code, 1, result.output);
    const [run] = await runs(f);
    assert.equal(run.total, 2);
    assert.equal(run.failed, 1);
    assert.equal(run.passed, 1);
    assert.ok((await logs(f, run)).every((r) => !r.testId && !r.fileId));
  },
);

test(
  "Bun: native watch reruns have independent cycles and idle state",
  { timeout: 35000 },
  async (t) => {
    const f = await fixture(
        t,
        "import {test} from 'bun:test';test('first',()=>{});",
      ),
      command = launch(f, [], { watch: true });
    const first = await until(f, command, async () => {
      const all = await runs(f);
      return all.find((r) => r.endedAt && r.watching && r.passed === 1);
    });
    await writeFile(
      f.file,
      "import {test} from 'bun:test';test('second',()=>{});test.skip('skip',()=>{});",
    );
    const second = await until(f, command, async () => {
      const all = await runs(f);
      return all.find(
        (r) => r.id !== first.id && r.endedAt && r.watching && r.passed === 1,
      );
    });
    assert.equal(second.cycle, 2);
    assert.equal(second.total, 2);
    assert.equal(second.skipped, 1);
    assert.equal(second.sessionId, first.sessionId);
    await command.stop();
    assert.ok((await runs(f)).every((r) => !r.watching));
  },
);

test(
  "Bun: concurrent commands and interruption preserve separate partial results",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      `import {test} from 'bun:test';test('passes',()=>{});test('held',${waitForRelease.toString()});`,
    );
    const first = launch(f, [], { gated: true }),
      second = launch(f, [], { gated: true });
    await until(f, [first, second], async () => {
      const all = await runs(f);
      return all.length === 2 && all.every((r) => r.passed === 1 && !r.endedAt);
    });
    await first.stop();
    await second.release();
    assert.equal((await second.done).code, 0);
    const all = await runs(f);
    assert.equal(new Set(all.map((r) => r.sessionId)).size, 2);
    assert.equal(all.filter((r) => r.status === "passed").length, 1);
    const interrupted = all.find((r) => r.status === "interrupted");
    assert.equal(interrupted.passed, 1);
    assert.equal(interrupted.cancelled, 1);
    assert.equal(interrupted.totalComplete, false);
  },
);

test(
  "Bun: exhausted retries, timeouts, skip/todo-only, empty selection and startup errors",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import {test} from 'bun:test';test('exhausted',()=>{throw Error('retry marker')},{retry:2});",
    );
    let result = await launch(f).done;
    assert.equal(result.code, 1, result.output);
    let [run] = await runs(f);
    assert.equal(run.failed, 1);
    assert.equal(run.retries, 2);
    assert.equal(run.total, 1);
    await writeFile(
      f.file,
      "import {test} from 'bun:test';test('timeout',async()=>{await Bun.sleep(100)},10);",
    );
    result = await launch(f).done;
    assert.equal(result.code, 1, result.output);
    assert.ok(
      (await runs(f)).some((r) =>
        r.tests.some((t) => t.nativeStatus === "timeout"),
      ),
    );
    await writeFile(
      f.file,
      "import {test} from 'bun:test';test.skip('skip',()=>{});test.todo('later');",
    );
    result = await launch(f).done;
    assert.equal(result.code, 0, result.output);
    assert.ok(
      (await runs(f)).some(
        (r) => r.status === "empty" && r.skipped === 1 && r.todo === 1,
      ),
    );
    result = await launch(f, [
      "--test-name-pattern",
      "missing",
      "--pass-with-no-tests",
    ]).done;
    assert.equal(result.code, 0, result.output);
    assert.ok(
      (await runs(f)).some((r) => r.status === "empty" && r.total === 0),
    );
    await writeFile(f.file, "throw Error('import marker');");
    result = await launch(f).done;
    assert.equal(result.code, 1, result.output);
    assert.ok((await runs(f)).some((r) => r.status === "error"));
  },
);

test(
  "Bun: empty project and inspector conflicts fail without reporting a pass",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await rm(f.file);
    const result = await launch(f, ["--pass-with-no-tests"]).done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.status, "empty");
    assert.equal(run.total, 0);
    const conflict = await launch(f, ["--inspect=127.0.0.1:0"]).done;
    assert.notEqual(conflict.code, 0);
    assert.match(conflict.output, /owns a local inspector/);
  },
);

test(
  "Bun: unobservable native parallel workers are rejected explicitly",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await writeFile(
      join(f.root, "other.test.ts"),
      "import {test} from 'bun:test';test('worker',()=>{});",
    );
    const result = await launch(f, ["--parallel=2"]).done;
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /parallel workers do not publish inspector/);
    const [run] = await runs(f);
    assert.equal(run.status, "error");
    assert.equal(run.totalComplete, false);
  },
);

test(
  "Bun: watch summaries cannot be forged by console output while a test is active",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
        t,
        `import {test} from 'bun:test';test('first',()=>{console.error('Ran 2 tests across 1 file. [0.01ms]')});test('held',${waitForRelease.toString()});`,
      ),
      command = launch(f, [], { watch: true, gated: true });
    await until(f, command, async () => {
      const [r] = await runs(f);
      return r?.passed === 1 && r.running === 1 && !r.endedAt;
    });
    await command.release();
    const ended = await until(f, command, async () => {
      const [r] = await runs(f);
      return r?.endedAt && r.watching ? r : false;
    });
    assert.equal(ended.total, 2);
    assert.equal(ended.passed, 2);
    assert.equal((await runs(f)).length, 1);
    await command.stop();
  },
);

test(
  "Bun: watch teardown errors are visible and the next cycle can recover",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
        t,
        "import {test,afterAll} from 'bun:test';test('passes',()=>{});afterAll(()=>{throw Error('watch teardown marker')});",
      ),
      command = launch(f, [], { watch: true });
    const first = await until(f, command, async () => {
      const all = await runs(f);
      return all.find((r) => r.endedAt && r.watching);
    });
    assert.equal(first.status, "error");
    assert.equal(first.passed, 1);
    assert.match(JSON.stringify(first.errors), /watch teardown marker/);
    await writeFile(
      f.file,
      "import {test} from 'bun:test';test('recovers',()=>{});",
    );
    const second = await until(f, command, async () => {
      const all = await runs(f);
      return all.find((r) => r.id !== first.id && r.endedAt && r.watching);
    });
    assert.equal(second.status, "passed");
    assert.equal(second.errors.length, 0);
    await command.stop();
  },
);

test(
  "Bun: rerun-each retains independent executions of identical declarations",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const result = await launch(f, ["--rerun-each=2"]).done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.total, 2, JSON.stringify(run));
    assert.equal(run.passed, 2);
    assert.equal(run.totalComplete, true);
  },
);

test(
  "Bun: coverage threshold failures override passed assertions",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import {test,expect} from 'bun:test';import {used} from './code';test('passes',()=>expect(used()).toBe(1));",
    );
    await writeFile(
      join(f.root, "code.ts"),
      "export function used(){return 1}\nexport function unused(){return 2}\n",
    );
    await writeFile(
      join(f.root, "bunfig.toml"),
      "[test]\ncoverage=true\ncoverageThreshold={functions=1.0,lines=1.0}\n",
    );
    const baseline = await launch(f, [], { native: true }).done;
    assert.notEqual(baseline.code, 0, baseline.output);
    const result = await launch(f).done;
    assert.equal(result.code, baseline.code, result.output);
    const [run] = await runs(f);
    assert.equal(run.passed, 1);
    assert.equal(run.status, "error");
  },
);

test(
  "Bun: runtime discovery requires explicit selection and reports the executable",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const doctor = captureProcess(
      spawn(
        process.execPath,
        [join(plugin, "server/cli.mjs"), "doctor", "--project", f.root],
        {
          env: { ...process.env, UNIT_TEST_PULSE_BUN_BIN: bun },
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    f.commands.push(doctor);
    const result = await doctor.done;
    assert.equal(result.code, 0, result.output);
    const info = JSON.parse(result.output);
    const candidate = info.runners.find((r) => r.runner === "bun");
    assert.equal(candidate.version, "1.4.3");
    assert.equal(candidate.executable, bun);
    assert.equal(candidate.supported, true);
    assert.ok(info.runners.some((r) => r.runner === "node"));
  },
);

test(
  "Bun: parameterized and dynamically titled tests retain all outcomes",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import {test,expect,describe} from 'bun:test';test.each([1,2])('case %i',value=>expect(value).toBeGreaterThan(0));describe('group',()=>{for(const value of [3,4])test('dynamic '+value,()=>expect(value).toBeGreaterThan(0))});",
    );
    const result = await launch(f).done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.passed, 4, JSON.stringify(run));
    assert.equal(run.total, 4);
    assert.equal(run.totalComplete, true);
  },
);

test(
  "Bun: unmatched name filters become idle with no executed tests in watch mode",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t),
      command = launch(
        f,
        ["--test-name-pattern", "not-present", "--pass-with-no-tests"],
        { watch: true },
      );
    const empty = await until(f, command, async () => {
      const all = await runs(f);
      return all.find((r) => r.endedAt && r.watching);
    });
    assert.equal(empty.status, "empty");
    assert.equal(empty.total, 0);
    await command.stop();
  },
);

test(
  "Bun: final large Unicode events survive repeated immediate shutdowns",
  { timeout: 30000 },
  async (t) => {
    const title = "final Unicode " + "💙".repeat(25000);
    const f = await fixture(
      t,
      `import {test,expect} from 'bun:test';test.each([1,2])('case %i',n=>expect(n).toBeGreaterThan(0));test(${JSON.stringify(title)},()=>{});`,
    );
    for (let attempt = 0; attempt < 12; attempt++) {
      const command = launch(f, ["--reporter=dots"]);
      const result = await command.done;
      assert.equal(result.code, 0, result.output);
      const id = /\[Unit Test Pulse\] Run ([a-f0-9]{32})/.exec(
        result.output,
      )?.[1];
      assert.ok(id, result.output);
      const run = (await runs(f)).find((r) => r.id === id);
      assert.equal(run.passed, 3, JSON.stringify(run));
      assert.equal(run.totalComplete, true);
      assert.ok(run.tests.some((t) => t.title === title));
    }
  },
);

test(
  "Bun: bail and explicit process exits keep native exit behavior",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "import {test} from 'bun:test';test('fails',()=>{throw Error('bail marker')});test('unexecuted',()=>{});",
    );
    let baseline = await launch(f, ["--bail=1"], { native: true }).done;
    let result = await launch(f, ["--bail=1"]).done;
    assert.equal(result.code, baseline.code, result.output);
    assert.notEqual(result.code, 0);
    await writeFile(
      f.file,
      "import {test} from 'bun:test';test('exits',()=>process.exit(3));test('unexecuted',()=>{});",
    );
    baseline = await launch(f, [], { native: true }).done;
    result = await launch(f).done;
    assert.equal(result.code, baseline.code, result.output);
    assert.equal(result.code, 3);
    assert.ok((await runs(f)).every((r) => r.status !== "passed"));
  },
);
