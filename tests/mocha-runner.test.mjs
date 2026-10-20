import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { discover } from "../server/environment.mjs";
import { readTestSource } from "../server/test-source.mjs";
import {
  captureProcess,
  createGate,
  readRuns,
  waitForRelease,
  waitForTelemetry,
} from "./support/telemetry.mjs";

const plugin = resolve(import.meta.dirname, "..");
async function fixture(t, version, body = "it('passes',()=>{});") {
  const root = await mkdtemp(join(tmpdir(), "pulse-mocha-"));
  const state = await mkdtemp(join(tmpdir(), "pulse-mocha-state-"));
  const commands = [];
  t.after(async () => {
    await Promise.all(commands.map((command) => command.stop()));
    await Promise.all(
      [root, state].map((path) => rm(path, { recursive: true, force: true })),
    );
  });
  await mkdir(join(root, "node_modules"));
  await symlink(
    join(plugin, "node_modules", version),
    join(root, "node_modules/mocha"),
    "dir",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "mocha-fixture", private: true, type: "module" }),
  );
  const file = join(root, "example.test.cjs");
  await writeFile(file, body);
  await writeFile(
    join(root, ".mocharc.cjs"),
    "module.exports={spec:['*.test.cjs'],timeout:30000};",
  );
  return { root, state, file, commands, version };
}
function launch(
  f,
  args = [],
  {
    watch = false,
    gated = false,
    native = false,
    automatic = false,
    env = {},
  } = {},
) {
  const gate = gated ? createGate(f.state) : null;
  const command = captureProcess(
    spawn(
      process.execPath,
      native
        ? [join(plugin, "node_modules", f.version, "bin/mocha.js"), ...args]
        : [
            join(plugin, "server/cli.mjs"),
            "run",
            "--project",
            f.root,
            "--state-dir",
            f.state,
            ...(automatic ? [] : ["--runner", "mocha"]),
            ...(watch ? ["--watch"] : []),
            "--",
            ...args,
          ],
      {
        cwd: f.root,
        env: {
          ...process.env,
          ...env,
          ...(gate ? { UNIT_TEST_PULSE_TEST_GATE: gate.path } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
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
const loadLogs = async (f, run) =>
  (await readFile(join(f.state, "runs", run.id, "logs.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);

for (const version of ["mocha11", "mocha"]) {
  test(
    `${version}: live results, assertion diagnostics, retries, skips, duplicate titles and source`,
    { timeout: 35000 },
    async (t) => {
      const body = `const assert=require('node:assert/strict');\ndescribe('cart',function(){\n it('passes',()=>{console.log('stdout marker');console.error('stderr marker');assert.equal(2+2,4)});\n it('fails',()=>assert.deepEqual({value:1},{value:2}));\n let attempts=0; it('retry pass',function(){this.retries(1);assert.equal(++attempts,2)});\n it.skip('skipped',()=>{}); it('pending');\n it('same',()=>{}); it('same',done=>done());\n it('slow',${waitForRelease.toString()});\n});`;
      const f = await fixture(t, version, body),
        command = launch(f, [], { gated: true, automatic: true });
      const partial = await until(f, command, async () => {
        const [r] = await runs(f);
        return r?.passed > 0 && !r.endedAt ? r : false;
      });
      assert.equal(partial.status, "running");
      assert.ok(partial.running > 0);
      await command.release();
      const result = await command.done;
      assert.equal(result.code, 1, result.output);
      const [run] = await runs(f);
      assert.equal(run.runner, "mocha");
      assert.equal(
        run.runnerVersion,
        version === "mocha11" ? "11.8.0" : "12.0.3",
      );
      assert.equal(run.total, 8);
      assert.equal(run.passed, 4);
      assert.equal(run.failed, 1);
      assert.equal(run.flaky, 1);
      assert.equal(run.retries, 1);
      assert.equal(run.skipped, 2);
      assert.equal(run.totalComplete, true);
      assert.equal(run.completed, 8);
      assert.equal(run.files[0].status, "failed");
      assert.equal(new Set(run.tests.map((t) => t.id)).size, 8);
      const failed = run.tests.find((t) => t.title === "fails");
      assert.deepEqual(failed.titlePath, ["cart", "fails"]);
      assert.match(failed.errors[0].stack, /example.test.cjs:4/);
      assert.match(failed.errors[0].actual, /value: 1/);
      assert.match(failed.errors[0].expected, /value: 2/);
      const source = await readTestSource(run, failed.id, f.root);
      assert.equal(source.startLine, 4);
      assert.match(source.text, /^it\('fails'/);
      const records = await loadLogs(f, run);
      for (const marker of ["stdout marker", "stderr marker"])
        assert.ok(records.some((r) => r.text.includes(marker)));
      assert.ok(
        records.every((r) => !r.testId && !r.fileId),
        "Do not invent log ownership",
      );
      assert.equal(await readFile(f.file, "utf8"), body);
      assert.deepEqual((await readdir(f.root)).sort(), [
        ".mocharc.cjs",
        "example.test.cjs",
        "node_modules",
        "package.json",
      ]);
      assert.equal(
        discover(f.root).find((r) => r.runner === "mocha").supported,
        true,
      );
    },
  );

  test(
    `${version}: native configuration, preloads, reporter options, async reporter completion and Node flags survive`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "const assert=require('node:assert/strict'); it('selected',()=>assert.equal(global.fixtureValue,42));it('excluded',()=>assert.fail('filtered'));",
      );
      await writeFile(join(f.root, "preload.cjs"), "global.fixtureValue=42;");
      await writeFile(
        join(f.root, "custom.cjs"),
        "const fs=require('node:fs');module.exports=class {constructor(runner,options){fs.appendFileSync('reporter.txt',options.reporterOptions.label+'\\n');runner.on('pass',t=>console.log('existing reporter:'+t.title))}done(failures,callback){setTimeout(()=>{fs.appendFileSync('reporter.txt','done\\n');callback(failures)},25)}}",
      );
      const config =
        "require('node:fs').appendFileSync('config.txt','loaded\\n');module.exports={spec:['*.test.cjs'],require:['./preload.cjs'],reporter:'./custom.cjs','reporter-option':['label=preserved'],grep:'selected'};";
      await writeFile(join(f.root, "alternate.cjs"), config);
      const args = [
        "--config",
        "alternate.cjs",
        "--node-option=enable-source-maps",
        "--exit",
      ];
      const baseline = await launch(f, args, { native: true }).done;
      assert.equal(baseline.code, 0, baseline.output);
      const nativeLoads = await readFile(join(f.root, "config.txt"), "utf8");
      const nativeReporter = await readFile(
        join(f.root, "reporter.txt"),
        "utf8",
      );
      await rm(join(f.root, "config.txt"));
      await rm(join(f.root, "reporter.txt"));
      const monitored = await launch(f, args).done;
      assert.equal(monitored.code, baseline.code, monitored.output);
      assert.equal(monitored.code, 0);
      assert.match(monitored.output, /existing reporter:selected/);
      assert.equal(
        await readFile(join(f.root, "config.txt"), "utf8"),
        nativeLoads,
      );
      assert.equal(
        await readFile(join(f.root, "reporter.txt"), "utf8"),
        nativeReporter,
      );
      assert.equal(
        await readFile(join(f.root, "alternate.cjs"), "utf8"),
        config,
      );
      const [run] = await runs(f);
      assert.equal(run.status, "passed");
      assert.equal(run.total, 1);
      assert.equal(run.totalComplete, true);
    },
  );

  test(
    `${version}: ESM and TypeScript declarations, aliases and TDD interface`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, version);
      await writeFile(
        join(f.root, "esm.test.mjs"),
        "import {it as check,describe as group} from 'mocha';group('ESM',()=>{check('aliased',()=>{});});",
      );
      await writeFile(
        join(f.root, "typed.test.ts"),
        "import {it} from 'mocha'; const value: number=42;it('typed',()=>{if(value!==42)throw Error('wrong')});",
      );
      const esm = await launch(f, [
        "--no-config",
        "esm.test.mjs",
        "typed.test.ts",
      ]).done;
      assert.equal(esm.code, 0, esm.output);
      let [run] = await runs(f);
      assert.equal(run.passed, 2);
      assert.match(
        (
          await readTestSource(
            run,
            run.tests.find((t) => t.title === "aliased").id,
            f.root,
          )
        ).text,
        /^check\('aliased'/,
      );
      await writeFile(
        f.file,
        "const {test:check,suite:group}=require('mocha');group('TDD',()=>{check('TDD case',()=>{})});",
      );
      const tdd = await launch(f, ["--ui", "tdd"]).done;
      assert.equal(tdd.code, 0, tdd.output);
      const all = await runs(f);
      run = all.find((r) => r.tests.some((t) => t.title === "TDD case"));
      assert.match(
        (await readTestSource(run, run.tests[0].id, f.root)).text,
        /^check\('TDD case'/,
      );
    },
  );

  for (const phase of ["before", "after"])
    test(
      `${version}: ${phase} hook failures stay visible`,
      { timeout: 30000 },
      async (t) => {
        const f = await fixture(
          t,
          version,
          `describe('hooks',()=>{${phase}(()=>{throw Error('${phase} hook marker')});it('assertion',()=>{});});`,
        );
        const baseline = await launch(f, [], { native: true }).done;
        const result = await launch(f).done;
        assert.equal(result.code, baseline.code, result.output);
        assert.notEqual(result.code, 0);
        const [run] = await runs(f);
        assert.equal(run.status, "error");
        assert.match(
          JSON.stringify(run.files[0].errors),
          new RegExp(phase + " hook marker"),
        );
        if (phase === "after") assert.equal(run.passed, 1);
      },
    );

  test(
    `${version}: parallel files retain failures, retries and duplicate identities`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "const assert=require('node:assert/strict');let n=0;describe('parallel',()=>{it('retry',function(){this.retries(1);assert.equal(++n,2)});it('same',()=>{});it('same',()=>{});});",
      );
      await writeFile(
        join(f.root, "second.test.cjs"),
        "it('failure',()=>{throw Error('parallel marker')});it.skip('skip',()=>{});",
      );
      const result = await launch(f, ["--parallel", "--jobs", "2"]).done;
      assert.equal(result.code, 1, result.output);
      const [run] = await runs(f);
      assert.equal(run.total, 5);
      assert.equal(run.flaky, 1);
      assert.equal(run.failed, 1);
      assert.equal(run.passed, 2);
      assert.equal(run.skipped, 1);
      assert.equal(run.files.length, 2);
      assert.equal(run.totalComplete, true);
      assert.equal(new Set(run.tests.map((t) => t.id)).size, 5);
      assert.match(
        run.tests.find((t) => t.title === "failure").errors[0].stack,
        /parallel marker/,
      );
      assert.ok(run.notices.some((n) => n.includes("buffered")));
    },
  );

  test(
    `${version}: independent watch cycles and idle state`,
    { timeout: 35000 },
    async (t) => {
      const f = await fixture(t, version, "it('first cycle',()=>{});"),
        command = launch(f, [], { watch: true });
      const first = await until(f, command, async () => {
        const all = await runs(f);
        return all.find((r) => r.endedAt && r.watching && r.passed === 1);
      });
      await writeFile(
        f.file,
        "it('second cycle',()=>{});it.skip('pending',()=>{});",
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
      assert.equal(
        second.tests.some((t) => t.title === "first cycle"),
        false,
      );
      await command.stop();
      assert.ok((await runs(f)).every((r) => !r.watching));
    },
  );

  test(
    `${version}: concurrent commands and interruption preserve partial results`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        `it('passes',()=>{});it('held',${waitForRelease.toString()});`,
      );
      const first = launch(f, [], { gated: true }),
        second = launch(f, [], { gated: true });
      await until(f, [first, second], async () => {
        const all = await runs(f);
        return (
          all.length === 2 && all.every((r) => r.passed === 1 && !r.endedAt)
        );
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
    `${version}: empty selections, dry runs, bail, startup errors and native failure exit codes`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "it('first',()=>{throw Error('failure 1')});it('second',()=>{throw Error('failure 2')});",
      );
      const native = await launch(f, [], { native: true }).done,
        normal = await launch(f).done;
      assert.equal(normal.code, native.code);
      assert.equal(normal.code, 2);
      const empty = await launch(f, ["--grep", "no-match"]).done;
      assert.equal(empty.code, 0);
      assert.ok(
        (await runs(f)).some((r) => r.status === "empty" && r.total === 0),
      );
      const dry = await launch(f, ["--dry-run"]).done;
      assert.equal(dry.code, 0, dry.output);
      assert.ok(
        (await runs(f)).some(
          (r) =>
            r.status === "empty" &&
            r.notices.some((n) => n.includes("dry-run")),
        ),
      );
      const bailed = await launch(f, ["--bail"]).done;
      assert.equal(bailed.code, 1);
      assert.ok(
        (await runs(f)).some((r) => r.failed === 1 && r.cancelled === 1),
      );
      await writeFile(
        join(f.root, "broken.cjs"),
        "throw Error('startup marker');",
      );
      const broken = await launch(f, ["--config", "broken.cjs"]).done;
      assert.notEqual(broken.code, 0);
      assert.match(broken.output, /startup marker/);
      assert.ok(
        (await runs(f)).some((r) => r.status === "error" && !r.totalComplete),
      );
    },
  );
}

for (const version of ["mocha11", "mocha"]) {
  test(
    `${version}: exhausted retries and a native zero failure exit still report failed assertions`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "it('retry exhausted',function(){this.retries(2);throw Error('final attempt marker')});",
      );
      const result = await launch(f, ["--pass-on-failing-test-suite"]).done;
      assert.equal(result.code, 0, result.output);
      const [run] = await runs(f);
      assert.equal(run.status, "failed");
      assert.equal(run.total, 1);
      assert.equal(run.failed, 1);
      assert.equal(run.retries, 2);
      assert.match(run.tests[0].errors[0].stack, /final attempt marker/);
    },
  );

  test(
    `${version}: reporter completion failures cannot hide behind passed assertions`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, version);
      await writeFile(
        join(f.root, "failing-reporter.cjs"),
        "module.exports=class {done(failures,callback){callback(failures+1)}};",
      );
      const args = ["--reporter", "./failing-reporter.cjs"];
      const baseline = await launch(f, args, { native: true }).done;
      const result = await launch(f, args).done;
      assert.equal(result.code, baseline.code, result.output);
      assert.notEqual(result.code, 0);
      const [run] = await runs(f);
      assert.equal(run.passed, 1);
      assert.equal(run.status, "error");
    },
  );

  test(
    `${version}: global teardown failures remain errors after passed assertions`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, version);
      await writeFile(
        join(f.root, "global.cjs"),
        "exports.mochaGlobalTeardown=()=>{throw Error('global teardown marker')};",
      );
      const args = ["--require", "./global.cjs"];
      const baseline = await launch(f, args, { native: true }).done;
      const result = await launch(f, args).done;
      assert.equal(result.code, baseline.code, result.output);
      if (version === "mocha") assert.notEqual(result.code, 0);
      const [run] = await runs(f);
      assert.equal(run.passed, 1);
      assert.equal(run.status, "error");
      assert.match(JSON.stringify(run.errors), /global teardown marker/);
    },
  );
}

test(
  "Mocha: large Unicode results cross journal read boundaries without corruption",
  { timeout: 30000 },
  async (t) => {
    const title = "Unicode 💙 ".repeat(10000);
    const f = await fixture(t, "mocha", `it(${JSON.stringify(title)},()=>{});`);
    const result = await launch(f, ["--reporter", "dot", "--exit"]).done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.status, "passed", JSON.stringify(run));
    assert.equal(run.tests[0].title, title);
  },
);
