import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
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
  const root = await mkdtemp(join(tmpdir(), "pulse-jasmine-"));
  const state = await mkdtemp(join(tmpdir(), "pulse-jasmine-state-"));
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
    join(root, "node_modules/jasmine"),
    "dir",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "jasmine-fixture", private: true, type: "module" }),
  );
  const file = join(root, "example.test.cjs");
  await writeFile(file, body);
  await mkdir(join(root, "spec/support"), { recursive: true });
  await writeFile(
    join(root, "spec/support/jasmine.json"),
    JSON.stringify({
      spec_dir: "",
      spec_files: ["*.test.cjs"],
      env: { random: false },
    }),
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
        ? [join(plugin, "node_modules", f.version, "bin/jasmine.js"), ...args]
        : [
            join(plugin, "server/cli.mjs"),
            "run",
            "--project",
            f.root,
            "--state-dir",
            f.state,
            ...(automatic ? [] : ["--runner", "jasmine"]),
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

for (const version of ["jasmine6", "jasmine"]) {
  test(
    `${version}: live progress, failures, debug logs, skipped tests, duplicate identities and source`,
    { timeout: 35000 },
    async (t) => {
      const body = `describe('cart',()=>{
 it('passes',()=>{console.log('stdout marker');console.error('stderr marker');expect(2+2).toBe(4)});
 it('fails',()=>{jasmine.debugLog('owned debug marker');expect({value:1}).toEqual({value:2})});
 xit('disabled',()=>{});it('pending',()=>pending('pending marker'));it('not applicable',()=>pending('another pending marker'));
 describe('first',()=>it('same',()=>{}));describe('second',()=>it('same',done=>done()));
 it('slow',${waitForRelease.toString()});
});`;
      const f = await fixture(t, version, body),
        command = launch(f, [], { gated: true, automatic: true });
      const partial = await until(f, command, async () => {
        const [r] = await runs(f);
        return r?.passed > 0 && r.running > 0 && !r.endedAt ? r : false;
      });
      assert.equal(partial.status, "running");
      assert.equal(partial.total, 8);
      await command.release();
      const result = await command.done;
      assert.equal(result.code, 3, result.output);
      const [run] = await runs(f);
      assert.equal(run.runner, "jasmine");
      assert.equal(
        run.runnerVersion,
        version === "jasmine6" ? "6.3.0" : "7.0.0",
      );
      assert.equal(run.total, 8);
      assert.equal(run.passed, 4);
      assert.equal(run.failed, 1);
      assert.equal(run.skipped, 3);
      assert.equal(run.totalComplete, true);
      assert.equal(run.completed, 8);
      assert.equal(new Set(run.tests.map((t) => t.id)).size, 8);
      const failed = run.tests.find((t) => t.title === "fails");
      assert.deepEqual(failed.titlePath, ["cart", "fails"]);
      assert.match(failed.errors[0].stack, /example.test.cjs:3/);
      assert.match(failed.errors[0].message, /value = 1 to equal 2/);
      const source = await readTestSource(run, failed.id, f.root);
      assert.equal(source.startLine, 3);
      assert.match(source.text, /^it\('fails'/);
      const logs = await loadLogs(f, run);
      assert.ok(
        logs.some(
          (r) =>
            r.text.includes("owned debug marker") && r.testId === failed.id,
        ),
      );
      for (const marker of ["stdout marker", "stderr marker"])
        assert.ok(
          logs.some((r) => r.text.includes(marker) && !r.testId && !r.fileId),
        );
      assert.ok(logs.some((r) => r.text === "pending marker" && r.testId));
      assert.equal(await readFile(f.file, "utf8"), body);
      assert.equal(
        discover(f.root).find((r) => r.runner === "jasmine").supported,
        true,
      );
    },
  );

  test(
    `${version}: native config, requires, helpers, custom reporters, random seed and filters survive`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "it('selected',()=>expect(global.fixtureValue+global.requiredValue).toBe(42));it('excluded',()=>fail('filtered'));",
      );
      await writeFile(join(f.root, "require.cjs"), "global.requiredValue=2;");
      await writeFile(join(f.root, "helper.cjs"), "global.fixtureValue=40;");
      const reporter =
        "const fs=require('node:fs');module.exports=class {jasmineStarted(r){fs.appendFileSync('reporter.txt','seed:'+r.order.seed+'\\n')}specDone(r){fs.appendFileSync('reporter.txt',r.description+':'+r.status+'\\n')}async jasmineDone(){await new Promise(r=>setTimeout(r,30));fs.appendFileSync('reporter.txt','async done\\n')}}";
      await writeFile(join(f.root, "custom.cjs"), reporter);
      const config =
        "require('node:fs').appendFileSync('config.txt','loaded\\n');module.exports={spec_dir:'',spec_files:['*.test.cjs'],helpers:['helper.cjs']};";
      await writeFile(join(f.root, "alternate.cjs"), config);
      const args = [
        "--config=alternate.cjs",
        "--require=./require.cjs",
        "--reporter=./custom.cjs",
        "--filter=selected",
        "--random=true",
        "--seed=54321",
      ];
      const native = await launch(f, args, { native: true }).done;
      assert.equal(native.code, 0, native.output);
      const loads = await readFile(join(f.root, "config.txt"), "utf8"),
        output = await readFile(join(f.root, "reporter.txt"), "utf8");
      await rm(join(f.root, "config.txt"));
      await rm(join(f.root, "reporter.txt"));
      const result = await launch(f, args).done;
      assert.equal(result.code, native.code, result.output);
      assert.equal(await readFile(join(f.root, "config.txt"), "utf8"), loads);
      assert.equal(
        await readFile(join(f.root, "reporter.txt"), "utf8"),
        output,
      );
      const [run] = await runs(f);
      assert.equal(run.passed, 1);
      assert.equal(run.skipped, 1);
      assert.equal(run.totalComplete, true);
      assert.ok(run.notices.some((n) => n.includes("54321")));
    },
  );

  test(
    `${version}: helper replacement reporters retain completion and telemetry`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, version);
      await writeFile(
        join(f.root, "helper.cjs"),
        "jasmine.getEnv().clearReporters();jasmine.getEnv().addReporter({jasmineDone:()=>require('node:fs').writeFileSync('helper-report.txt','done')});",
      );
      const args = ["--helper=helper.cjs"];
      const native = await launch(f, args, { native: true }).done;
      assert.equal(native.code, 0, native.output);
      await rm(join(f.root, "helper-report.txt"));
      const result = await launch(f, args).done;
      assert.equal(result.code, 0, result.output);
      assert.equal(
        await readFile(join(f.root, "helper-report.txt"), "utf8"),
        "done",
      );
      assert.equal((await runs(f))[0].passed, 1);
    },
  );

  for (const phase of ["beforeAll", "afterAll", "beforeEach", "afterEach"])
    test(
      `${version}: ${phase} failures remain visible`,
      { timeout: 30000 },
      async (t) => {
        const f = await fixture(
          t,
          version,
          `describe('hooks',()=>{${phase}(()=>{throw Error('${phase} marker')});it('assertion',()=>expect(true).toBeTrue())});`,
        );
        const native = await launch(f, [], { native: true }).done,
          result = await launch(f).done;
        assert.equal(result.code, native.code, result.output);
        assert.notEqual(result.code, 0);
        const [run] = await runs(f);
        assert.notEqual(run.status, "passed");
        assert.match(
          JSON.stringify([
            ...run.errors,
            ...run.files.flatMap((f) => f.errors),
            ...run.tests.flatMap((t) => t.errors),
          ]),
          new RegExp(phase + " marker"),
        );
        if (phase === "afterAll") assert.equal(run.passed, 1);
      },
    );

  test(
    `${version}: parallel files preserve nested paths, duplicate titles, errors, skips and debug ownership`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "describe('outer',()=>describe('inner',()=>{describe('first',()=>it('same',()=>{}));describe('second',()=>it('same',()=>{}));it('fails',()=>{jasmine.debugLog('parallel debug');expect(1).toBe(2)})}));",
      );
      await writeFile(
        join(f.root, "second.test.cjs"),
        "describe('other',()=>{it('same',()=>{});xit('skip',()=>{});});",
      );
      await writeFile(
        join(f.root, "spec/support/jasmine.json"),
        JSON.stringify({
          spec_dir: "",
          spec_files: ["*.test.cjs"],
          env: { random: true },
        }),
      );
      const args = ["--parallel=2"];
      const native = await launch(f, args, { native: true }).done,
        result = await launch(f, args).done;
      assert.equal(result.code, native.code, result.output);
      assert.equal(result.code, 3, result.output);
      const [run] = await runs(f);
      assert.equal(run.total, 5);
      assert.equal(run.passed, 3);
      assert.equal(run.failed, 1);
      assert.equal(run.skipped, 1);
      assert.equal(run.files.length, 2);
      assert.equal(run.totalComplete, true);
      assert.equal(new Set(run.tests.map((t) => t.id)).size, 5);
      const failed = run.tests.find((t) => t.title === "fails");
      assert.deepEqual(failed.titlePath, ["outer", "inner", "fails"]);
      assert.ok(
        (await loadLogs(f, run)).some(
          (r) => r.text === "parallel debug" && r.testId === failed.id,
        ),
      );
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
        ),
        first = launch(f, [], { gated: true }),
        second = launch(f, [], { gated: true });
      await until(f, [first, second], async () => {
        const all = await runs(f);
        return (
          all.length === 2 &&
          all.every((r) => r.passed === 1 && r.running === 1 && !r.endedAt)
        );
      });
      await first.stop();
      await second.release();
      assert.equal((await second.done).code, 0);
      const all = await runs(f);
      assert.equal(new Set(all.map((r) => r.sessionId)).size, 2);
      const interrupted = all.find((r) => r.status === "interrupted");
      assert.equal(interrupted.passed, 1);
      assert.equal(interrupted.cancelled, 1);
      assert.equal(interrupted.totalComplete, false);
    },
  );

  test(
    `${version}: empty filters, focused tests, fail-fast, startup errors and explicit exits retain native behavior`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "it('fails',()=>expect(1).toBe(2));it('later',()=>{});",
      );
      for (const args of [["--filter=unmatched"], ["--fail-fast"]]) {
        const native = await launch(f, args, { native: true }).done,
          result = await launch(f, args).done;
        assert.equal(result.code, native.code, result.output);
        assert.equal(
          result.code,
          args[0].includes("filter") ? 0 : 3,
          result.output,
        );
      }
      assert.ok(
        (await runs(f)).some(
          (r) => r.passed === 0 && r.skipped === 2 && r.status !== "passed",
        ),
      );
      await writeFile(f.file, "fit('focused',()=>{});it('excluded',()=>{});");
      const native = await launch(f, [], { native: true }).done,
        result = await launch(f).done;
      assert.equal(result.code, native.code, result.output);
      assert.notEqual(result.code, 0);
      assert.ok(
        (await runs(f)).some(
          (r) =>
            r.passed === 1 && r.notices.some((n) => n.includes("incomplete")),
        ),
      );
      await writeFile(
        join(f.root, "broken.cjs"),
        "throw Error('startup marker')",
      );
      const broken = await launch(f, ["--config=broken.cjs"]).done;
      assert.notEqual(broken.code, 0);
      assert.match(broken.output, /startup marker/);
      await writeFile(f.file, "it('exits',()=>process.exit(3));");
      const nativeExit = await launch(f, [], { native: true }).done;
      const exit = await launch(f).done;
      assert.equal(exit.code, nativeExit.code, exit.output);
      assert.equal(exit.code, 4, exit.output);
      assert.ok((await runs(f)).every((r) => r.status !== "passed"));
    },
  );

  for (const phase of ["globalSetup", "globalTeardown"])
    test(
      `${version}: ${phase} errors remain visible`,
      { timeout: 30000 },
      async (t) => {
        const f = await fixture(t, version);
        await writeFile(
          join(f.root, "global.cjs"),
          `module.exports={spec_dir:'',spec_files:['*.test.cjs'],${phase}:()=>{throw Error('${phase} marker')}};`,
        );
        const args = ["--config=global.cjs"];
        const native = await launch(f, args, { native: true }).done,
          result = await launch(f, args).done;
        assert.equal(result.code, native.code, result.output);
        assert.notEqual(result.code, 0);
        const [run] = await runs(f);
        assert.equal(run.status, "error");
        assert.match(JSON.stringify(run.errors), new RegExp(phase + " marker"));
        if (phase === "globalTeardown") assert.equal(run.passed, 1);
      },
    );

  test(
    `${version}: global load and reporter failures cannot hide behind successful assertions`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "it('passes',()=>{});throw Error('definition marker');",
      );
      const native = await launch(f, [], { native: true }).done,
        result = await launch(f).done;
      assert.equal(result.code, native.code, result.output);
      assert.notEqual(result.code, 0);
      let all = await runs(f);
      assert.match(JSON.stringify(all[0].errors), /definition marker/);
      await writeFile(f.file, "it('passes',()=>{});");
      await writeFile(
        join(f.root, "bad-reporter.cjs"),
        "module.exports=class {specDone(){throw Error('reporter marker')}};",
      );
      const args = ["--reporter=./bad-reporter.cjs"];
      const baseline = await launch(f, args, { native: true }).done,
        monitored = await launch(f, args).done;
      assert.equal(monitored.code, baseline.code, monitored.output);
      assert.notEqual(monitored.code, 0);
      all = await runs(f);
      assert.ok(all.every((r) => r.status !== "passed"));
    },
  );
}

test(
  "Jasmine: TypeScript and imported aliases retain source previews",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, "jasmine");
    await symlink(
      join(plugin, "node_modules/jasmine-core"),
      join(f.root, "node_modules/jasmine-core"),
      "dir",
    );
    await writeFile(
      join(f.root, "typed.test.ts"),
      "import core from 'jasmine-core';const value:number=42;core.describe('typed',()=>{core.it('aliased',()=>core.expect(value).toBe(42));});",
    );
    const result = await launch(f, ["typed.test.ts"]).done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.passed, 1);
    assert.deepEqual(run.tests[0].titlePath, ["typed", "aliased"]);
    assert.match(
      (await readTestSource(run, run.tests[0].id, f.root)).text,
      /^core\.it\('aliased'/,
    );
  },
);

test(
  "Jasmine: large Unicode final events survive explicit native exit",
  { timeout: 30000 },
  async (t) => {
    const title = "Unicode 💙 ".repeat(10000),
      f = await fixture(
        t,
        "jasmine",
        `it(${JSON.stringify(title)},()=>{expect(1).toBe(1)});`,
      );
    for (let i = 0; i < 4; i++) {
      const result = await launch(f).done;
      assert.equal(result.code, 0, result.output);
      const id = /\[Unit Test Pulse\] Run ([a-f0-9]{32})/.exec(
        result.output,
      )?.[1];
      const run = (await runs(f)).find((r) => r.id === id);
      assert.equal(run?.tests[0]?.title, title);
      assert.ok(run);
      assert.equal(run.totalComplete, true);
      assert.equal(run.passed, 1);
    }
  },
);

test(
  "Jasmine: unsupported watch and non-test commands are rejected explicitly",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, "jasmine");
    const watch = await launch(f, [], { watch: true }).done;
    assert.notEqual(watch.code, 0);
    assert.match(watch.output, /no native watch mode/);
    const enumerate = await launch(f, ["enumerate"]).done;
    assert.notEqual(enumerate.code, 0);
    assert.match(enumerate.output, /Use native Jasmine/);
  },
);

for (const version of ["jasmine6", "jasmine"]) {
  test(
    `${version}: timeouts, callback errors and skipped suites retain native diagnostics`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "describe('async',()=>{it('timeout',done=>{},30);it('callback failure',done=>done.fail('callback marker'));});xdescribe('disabled suite',()=>it('not run',()=>fail('must not run')));",
      );
      const native = await launch(f, [], { native: true }).done,
        result = await launch(f).done;
      assert.equal(result.code, native.code, result.output);
      assert.equal(result.code, 3);
      const [run] = await runs(f);
      assert.equal(run.failed, 2);
      assert.equal(run.skipped, 1);
      assert.match(JSON.stringify(run.tests), /Timeout|timed out/);
      assert.match(JSON.stringify(run.tests), /callback marker/);
      assert.equal(run.totalComplete, true);
    },
  );
  test(
    `${version}: parallel workers reuse local identities across multiple files without losing results`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "describe('file 0',()=>it('same',()=>{}));",
      );
      for (let i = 1; i < 6; i++)
        await writeFile(
          join(f.root, `file-${i}.test.cjs`),
          `describe('file ${i}',()=>it('same',()=>{}));`,
        );
      await writeFile(
        join(f.root, "spec/support/jasmine.json"),
        JSON.stringify({ spec_dir: "", spec_files: ["*.test.cjs"] }),
      );
      const result = await launch(f, ["--parallel=2"]).done;
      assert.equal(result.code, 0, result.output);
      const [run] = await runs(f);
      assert.equal(run.passed, 6);
      assert.equal(run.files.length, 6);
      assert.equal(new Set(run.tests.map((t) => t.id)).size, 6);
      for (const test of run.tests)
        assert.match(test.titlePath[0], /^file \d$/);
      assert.equal(run.totalComplete, true);
    },
  );
  test(
    `${version}: environment-selected config, Node preloads, custom config reporters and files remain intact`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(
        t,
        version,
        "it('selected',()=>expect(global.preloadValue).toBe(42));",
      );
      await writeFile(join(f.root, "preload.cjs"), "global.preloadValue=42;");
      const config =
        "module.exports={spec_dir:'',spec_files:['*.test.cjs'],reporters:[{specDone(r){console.log('configured reporter:'+r.description)}}],env:{random:false}};";
      await writeFile(join(f.root, "selected.cjs"), config);
      const env = {
        JASMINE_CONFIG_PATH: "selected.cjs",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${join(f.root, "preload.cjs")}`,
      };
      const baseline = await launch(f, [], { native: true, env }).done,
        result = await launch(f, [], { env }).done;
      assert.equal(result.code, baseline.code, result.output);
      assert.equal(result.code, 0);
      assert.match(result.output, /configured reporter:selected/);
      assert.equal((await runs(f))[0].passed, 1);
      assert.equal(
        await readFile(join(f.root, "selected.cjs"), "utf8"),
        config,
      );
    },
  );
}

test(
  "Jasmine 7: notApplicable is skipped with its explicit reason",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "jasmine",
      "it('not relevant',()=>notApplicable('not relevant marker'));it('passes',()=>{});",
    );
    const result = await launch(f).done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.passed, 1);
    assert.equal(run.skipped, 1);
    assert.equal(
      run.tests.find((t) => t.title === "not relevant").nativeStatus,
      "notApplicable",
    );
    assert.ok(
      (await loadLogs(f, run)).some(
        (r) => r.text === "not relevant marker" && r.testId,
      ),
    );
  },
);

test(
  "Jasmine: CommonJS declaration aliases retain source previews",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "jasmine",
      "const {it:check,describe:group}=require('jasmine-core');group('aliases',()=>check('selected',()=>{}));",
    );
    await symlink(
      join(plugin, "node_modules/jasmine-core"),
      join(f.root, "node_modules/jasmine-core"),
      "dir",
    );
    const result = await launch(f).done;
    assert.equal(result.code, 0, result.output);
    const [run] = await runs(f);
    assert.equal(run.passed, 1);
    assert.match(
      (await readTestSource(run, run.tests[0].id, f.root)).text,
      /^check\('selected'/,
    );
  },
);
