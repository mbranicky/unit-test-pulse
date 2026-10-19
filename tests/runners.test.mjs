import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  mkdir,
  symlink,
  rm,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readTestSource } from "../server/test-source.mjs";
import {
  captureProcess,
  createGate,
  readRuns,
  waitForRelease,
  waitForTelemetry,
} from "./support/telemetry.mjs";
const plugin = resolve(import.meta.dirname, "..");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(t, runner, vitestPackage = "vitest") {
  const root = await mkdtemp(join(tmpdir(), `pulse-${runner}-`));

  const state = await mkdtemp(join(tmpdir(), "pulse-telemetry-"));
  const commands = [];
  t.after(async () => {
    await Promise.all(commands.map((command) => command.stop()));
    await Promise.all(
      [root, state].map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  await mkdir(join(root, "node_modules"));
  const vitestPath =
    vitestPackage === "vitest4"
      ? join(plugin, "tests/compat/vitest4/node_modules/vitest")
      : join(plugin, "node_modules/vitest");
  assert.ok(
    (await readFile(join(vitestPath, "package.json"), "utf8")).includes(
      "vitest",
    ),
    "Run npm run setup:compat before integration tests",
  );
  await symlink(vitestPath, join(root, "node_modules", "vitest"), "dir");
  await symlink(
    join(plugin, "node_modules", "jest"),
    join(root, "node_modules", "jest"),
    "dir",
  );
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "pulse-fixture", private: true, type: "module" }),
  );
  const reporter =
    runner === "vitest"
      ? `export default class Reporter { onTestRunEnd() { requireWrite() } }\nimport {appendFileSync as requireWriteFile} from 'node:fs'; function requireWrite() { requireWriteFile(${JSON.stringify(join(root, "reporter.txt"))}, 'called\\n'); }`
      : `module.exports = class Reporter { onRunComplete() { require('node:fs').appendFileSync(${JSON.stringify(join(root, "reporter.txt"))}, 'called\\n'); } };`;
  await writeFile(
    join(
      root,
      runner === "vitest" ? "custom-reporter.mjs" : "custom-reporter.cjs",
    ),
    reporter,
  );
  const config =
    runner === "vitest"
      ? `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(root, "config-loads.txt"))}, 'loaded\\n'); export default { test: { reporters: ['default', './custom-reporter.mjs'], include: ['*.test.ts'], retry: 1 } };`
      : `const fs = require('node:fs'); module.exports = async () => { fs.appendFileSync(${JSON.stringify(join(root, "config-loads.txt"))}, 'loaded\\n'); return { testMatch:['<rootDir>/*.test.cjs'], reporters: ['default', ['<rootDir>/custom-reporter.cjs', {label:'kept'}]], testEnvironment:'node' }; };`;
  await writeFile(
    join(root, runner === "vitest" ? "vitest.config.ts" : "jest.config.cjs"),
    config,
  );
  const body =
    runner === "vitest"
      ? `import {test,expect} from 'vitest';\nlet attempt = 0;\ntest('passes',()=>{ console.log('test-specific marker'); expect(2+2).toBe(4) });\ntest('fails',()=>{ expect({value:1}).toEqual({value:2}) });\ntest('retry pass',()=>{ expect(++attempt).toBe(2) });\ntest.skip('skipped',()=>{}); test.todo('future work');\ntest('slow',${waitForRelease.toString()},30000);`
      : `test('passes',()=>{ console.log('file marker'); expect(2+2).toBe(4) });\ntest('fails',()=>{ expect({value:1}).toEqual({value:2}) });\ntest.skip('skipped',()=>{}); test.todo('future work');\ntest('slow',${waitForRelease.toString()},30000);`;
  const file = join(
    root,
    runner === "vitest" ? "example.test.ts" : "example.test.cjs",
  );
  await writeFile(file, body);
  return { root, file, state, commands };
}
function launch(f, runner, watch = false, { gated = false, env = {} } = {}) {
  const gate = gated ? createGate(f.state) : null;
  const proc = spawn(
    process.execPath,
    [
      join(plugin, "server/cli.mjs"),
      "run",
      "--project",
      f.root,
      "--state-dir",
      f.state,
      "--runner",
      runner,
      ...(watch ? ["--watch"] : []),
      "--",
      ...(runner === "jest" ? ["--runInBand"] : []),
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
  );
  const command = captureProcess(proc);
  command.release = () => gate?.release();
  f.commands.push(command);
  return command;
}
const runs = (f) => readRuns(f.state);
const until = (f, predicate, timeout) =>
  waitForTelemetry(predicate, {
    commands: f.commands,
    snapshot: () => runs(f),
    ...(timeout === undefined ? {} : { timeout }),
  });
for (const runner of ["vitest", "jest"])
  test(
    `${runner}: real partial results, failures, logs, configuration, and existing reporters`,
    { timeout: 45000 },
    async (t) => {
      const f = await fixture(t, runner);
      const checksum = createHash("sha256")
        .update(await readFile(f.file))
        .digest("hex");
      const native = spawn(
        process.execPath,
        [
          join(
            plugin,
            "node_modules",
            runner === "vitest" ? "vitest/vitest.mjs" : "jest/bin/jest.js",
          ),
          ...(runner === "vitest" ? ["run"] : ["--runInBand"]),
        ],
        { cwd: f.root, stdio: "ignore" },
      );
      const baseline = captureProcess(native);
      f.commands.push(baseline);
      await baseline.done;
      f.commands.splice(f.commands.indexOf(baseline), 1);
      const baselineLoads = await readFile(
        join(f.root, "config-loads.txt"),
        "utf8",
      );
      await rm(join(f.root, "config-loads.txt"));
      await rm(join(f.root, "reporter.txt"));
      const command = launch(f, runner, false, { gated: true });
      const { done } = command;
      // Exercise an observer delayed past the former fixed-duration window.
      await wait(1700);
      const partial = await until(f, async () => {
        const [r] = await runs(f);
        return r?.tests.some((t) => t.status === "passed") && !r.endedAt
          ? r
          : false;
      });
      assert.equal(partial.status, "running");
      await command.release();
      const result = await done;
      assert.equal(result.code, 1, result.text);
      const [run] = await runs(f);
      assert.equal(run.status, "failed");
      assert.equal(run.failed, 1);
      assert.equal(run.skipped, 1);
      assert.equal(run.todo, 1);
      assert.equal(run.completed, run.total);
      const passed = run.tests.find((item) => item.title === "passes");
      assert.ok(
        passed.location?.line > 0,
        "runner supplies test source locations",
      );
      const source = await readTestSource(run, passed.id, f.root);
      assert.match(source.text, /test\('passes'/);
      assert.doesNotMatch(source.text, /test\('fails'/);
      assert.equal(source.startLine, runner === "vitest" ? 3 : 1);
      assert.ok(
        run.tests
          .find((t) => t.status === "failed")
          .errors.some((e) => e.stack || e.message.includes("Expected")),
      );
      if (runner === "vitest") assert.equal(run.flaky, 1);
      assert.match(
        await readFile(join(f.root, "reporter.txt"), "utf8"),
        /called/,
      );
      assert.equal(
        await readFile(join(f.root, "config-loads.txt"), "utf8"),
        baselineLoads,
        "config evaluation must match the native runner",
      );
      assert.equal(
        createHash("sha256")
          .update(await readFile(f.file))
          .digest("hex"),
        checksum,
      );
      const log = await readFile(
        join(f.state, "runs", run.id, "logs.jsonl"),
        "utf8",
      );
      assert.match(log, /marker/);
      if (runner === "vitest") {
        const records = log.trim().split("\n").map(JSON.parse);
        assert.ok(
          records.some((r) => r.stream === "console" && r.testId),
          log,
        );
      }
    },
  );
for (const runner of ["vitest", "jest"])
  test(
    `${runner}: watch cycles are independent and idle is observable`,
    { timeout: 45000 },
    async (t) => {
      const f = await fixture(t, runner),
        { proc, done } = launch(f, runner, true);
      const first = await until(f, async () => {
        const [r] = await runs(f);
        return r?.endedAt && r.watching ? r : false;
      });
      await wait(500);
      await writeFile(
        f.file,
        (await readFile(f.file, "utf8")) + "\n// trigger the next cycle\n",
      );
      const second = await until(f, async () => {
        const rs = await runs(f);
        return rs.length >= 2 && rs[1].endedAt ? rs[1] : false;
      });
      assert.notEqual(first.id, second.id);
      assert.equal(first.sessionId, second.sessionId);
      assert.equal(second.cycle, 2);
      assert.equal(first.total, second.total);
      assert.equal(first.failed, second.failed);
      proc.kill("SIGTERM");
      await done;
    },
  );
for (const runner of ["vitest", "jest"])
  test(
    `${runner}: configuration failure without test results is an error`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, runner);
      await writeFile(
        join(
          f.root,
          runner === "vitest" ? "vitest.config.ts" : "jest.config.cjs",
        ),
        "throw new Error('broken configuration marker')",
      );
      const { proc, done } = launch(f, runner);
      const result = await done;
      assert.equal(result.code, 1);
      const [run] = await runs(f);
      assert.equal(run.status, "error", result.text);
      assert.equal(run.total, 0);
      assert.match(JSON.stringify(run.errors), /broken configuration marker/);
    },
  );
test(
  "Vitest 4: real results, console attribution, and watch reruns",
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t, "vitest", "vitest4"),
      { proc, done } = launch(f, "vitest", true);
    const first = await until(f, async () => {
      const [r] = await runs(f);
      return r?.endedAt && r.watching ? r : false;
    });
    assert.equal(first.runnerVersion, "4.1.11");
    assert.equal(first.failed, 1);
    assert.equal(first.flaky, 1);
    assert.equal(first.todo, 1);
    const log = await readFile(
      join(f.state, "runs", first.id, "logs.jsonl"),
      "utf8",
    );
    assert.ok(
      log
        .trim()
        .split("\n")
        .map(JSON.parse)
        .some((r) => r.testId),
    );
    await wait(500);
    await writeFile(
      f.file,
      (await readFile(f.file, "utf8")) + "\n// Vitest 4 rerun\n",
    );
    const second = await until(f, async () => {
      const rs = await runs(f);
      return rs.length >= 2 && rs[1].endedAt ? rs[1] : false;
    });
    assert.equal(second.cycle, 2);
    assert.equal(second.total, first.total);
    proc.kill("SIGTERM");
    await done;
  },
);
for (const runner of ["vitest", "jest"])
  test(
    `${runner}: concurrent commands stay independent and interruption preserves partial results`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, runner);
      const first = launch(f, runner, false, { gated: true });
      await until(f, async () => {
        const [run] = await runs(f);
        return (
          run?.tests.some((test) => test.status === "passed") && !run.endedAt
        );
      });
      // Reproduce a second command starting after the old 1.2-second window.
      await wait(1700);
      const second = launch(f, runner, false, { gated: true });
      const [beforeSecond] = await runs(f);
      assert.equal(
        beforeSecond.endedAt,
        null,
        "the first command must stay available for observation during delayed startup",
      );
      await until(f, async () => {
        const rs = await runs(f);
        return (
          rs.length === 2 &&
          rs.every(
            (r) => r.tests.some((t) => t.status === "passed") && !r.endedAt,
          )
        );
      });
      await first.stop();
      await second.release();
      const [a, b] = await Promise.all([first.done, second.done]);
      const rs = await runs(f);
      assert.equal(rs.length, 2);
      assert.notEqual(rs[0].sessionId, rs[1].sessionId);
      assert.ok(rs.some((r) => r.status === "interrupted"));
      assert.ok(rs.some((r) => r.status === "failed"));
      assert.notEqual(a.code, 0);
      assert.equal(b.code, 1);
    },
  );
for (const runner of ["vitest", "jest"])
  test(
    `${runner}: duplicate titles and parameterized cases do not overwrite results`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, runner);
      await writeFile(
        f.file,
        runner === "vitest"
          ? "import {test,expect} from 'vitest'; test('same title',()=>expect(1).toBe(1)); test('same title',()=>expect(2).toBe(2)); test.each([1,2])('case %s',value=>expect(value).toBeGreaterThan(0));"
          : "test('same title',()=>expect(1).toBe(1)); test('same title',()=>expect(2).toBe(2)); test.each([1,2])('case %s',value=>expect(value).toBeGreaterThan(0));",
      );
      const { proc, done } = launch(f, runner);
      const result = await done;
      const [run] = await runs(f);
      assert.equal(result.code, 0, result.text);
      assert.equal(run.passed, 4);
      assert.equal(run.total, 4);
      assert.equal(new Set(run.tests.map((t) => t.id)).size, 4);
      for (const item of run.tests) {
        const source = await readTestSource(run, item.id, f.root);
        assert.equal(source.startLine, 1);
        if (item.title.startsWith("case "))
          assert.match(source.text, /^test\.each/);
        else assert.doesNotMatch(source.text, /test\.each/);
      }
      assert.notEqual(
        (await readTestSource(run, run.tests[0].id, f.root)).text,
        (await readTestSource(run, run.tests[1].id, f.root)).text,
      );
    },
  );
test(
  "Jest: nested configuration preserves a preset reporter, custom environment, and TypeScript transform",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, "jest");
    await mkdir(join(f.root, "config"));
    await rm(join(f.root, "jest.config.cjs"));
    await writeFile(
      join(f.root, "preset.cjs"),
      "module.exports={reporters:['default',['<rootDir>/custom-reporter.cjs',{label:'from preset'}]]};",
    );
    await writeFile(
      join(f.root, "environment.cjs"),
      `const {TestEnvironment}=require(${JSON.stringify(join(plugin, "node_modules/jest-environment-node"))}); module.exports=class extends TestEnvironment{async setup(){await super.setup();this.global.fixtureEnvironment='preserved';}};`,
    );
    await writeFile(
      join(f.root, "transform.cjs"),
      "module.exports={process(source){return {code:require('node:module').stripTypeScriptTypes(source)}}};",
    );
    await writeFile(
      join(f.root, "config/jest.config.cjs"),
      "module.exports={rootDir:'..',preset:'./preset.cjs',testMatch:['<rootDir>/*.test.ts'],testEnvironment:'<rootDir>/environment.cjs',transform:{'^.+\\\\.ts$':'<rootDir>/transform.cjs'}};",
    );
    await writeFile(
      join(f.root, "preserved.test.ts"),
      "const typed: number = 42; test('keeps environment and transform',()=>{expect(typed).toBe(42);expect(globalThis.fixtureEnvironment).toBe('preserved')});",
    );
    const proc = spawn(
      process.execPath,
      [
        join(plugin, "server/cli.mjs"),
        "run",
        "--project",
        f.root,
        "--state-dir",
        f.state,
        "--runner",
        "jest",
        "--",
        "--config",
        "config/jest.config.cjs",
        "--runInBand",
      ],
      { cwd: f.root, stdio: ["ignore", "pipe", "pipe"] },
    );
    f.commands.push(captureProcess(proc));
    let text = "";
    proc.stdout.on("data", (b) => (text += b));
    proc.stderr.on("data", (b) => (text += b));
    const code = await new Promise((r) => proc.once("close", r));
    assert.equal(code, 0, text);
    const [run] = await runs(f);
    assert.equal(run.passed, 1);
    assert.match(
      await readFile(join(f.root, "reporter.txt"), "utf8"),
      /called/,
    );
  },
);
test(
  "Jest: coverage threshold failure cannot turn passing assertions into a successful verification",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, "jest");
    await writeFile(
      join(f.root, "calc.cjs"),
      "exports.calc = value => { if(value) return 1; return 2; };\n",
    );
    await writeFile(
      f.file,
      "test('covers one branch',()=>expect(require('./calc.cjs').calc(true)).toBe(1));",
    );
    await writeFile(
      join(f.root, "jest.config.cjs"),
      "module.exports={testMatch:['<rootDir>/*.test.cjs'],collectCoverage:true,coverageProvider:'v8',collectCoverageFrom:['calc.cjs'],coverageReporters:['json-summary'],coverageThreshold:{global:{branches:100,lines:100,statements:100,functions:100}}};",
    );
    const { proc, done } = launch(f, "jest");
    const result = await done;
    const [run] = await runs(f);
    assert.equal(result.code, 1, result.text);
    assert.equal(run.passed, 1);
    assert.equal(run.failed, 0);
    assert.notEqual(run.status, "passed");
    assert.equal(run.exitCode, 1);
  },
);
test(
  "Jest: a configured zero test-failure exit code is preserved without hiding failed assertions",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, "jest");
    await writeFile(
      f.file,
      "test('fails intentionally',()=>expect(1).toBe(2));",
    );
    await writeFile(
      join(f.root, "jest.config.cjs"),
      "module.exports={testMatch:['<rootDir>/*.test.cjs'],testFailureExitCode:0};",
    );
    const { proc, done } = launch(f, "jest");
    const result = await done;
    const [run] = await runs(f);
    assert.equal(result.code, 0, result.text);
    assert.equal(run.failed, 1);
    assert.equal(run.status, "failed");
  },
);
for (const runner of ["vitest", "jest"])
  test(
    `${runner}: no-test selections with passWithNoTests are not successful verification`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, runner);
      await rm(f.file);
      const proc = spawn(
        process.execPath,
        [
          join(plugin, "server/cli.mjs"),
          "run",
          "--project",
          f.root,
          "--state-dir",
          f.state,
          "--runner",
          runner,
          "--",
          "--passWithNoTests",
          ...(runner === "jest" ? ["--runInBand"] : []),
        ],
        { cwd: f.root, stdio: ["ignore", "pipe", "pipe"] },
      );
      f.commands.push(captureProcess(proc));
      let text = "";
      proc.stdout.on("data", (b) => (text += b));
      proc.stderr.on("data", (b) => (text += b));
      const code = await new Promise((r) => proc.once("close", r));
      const [run] = await runs(f);
      assert.equal(code, 0, text);
      assert.equal(run.passed, 0);
      assert.notEqual(run.status, "passed");
      assert.equal(run.total, 0);
    },
  );

for (const version of ["vitest", "vitest4"])
  for (const pool of ["forks", "threads", "vmForks", "vmThreads"])
    test(
      `${version}: ${pool} task updates reach the observer at exact timer boundaries`,
      { timeout: 30000 },
      async (t) => {
        const f = await fixture(t, "vitest", version);
        const preload = join(f.root, "clock-boundary.mjs");
        await writeFile(
          preload,
          "const now=Date.now; Date.now=()=>Math.floor(now()/100)*100; globalThis.pulsePreload=true;\n",
        );
        if (pool.startsWith("vm"))
          await writeFile(
            join(f.root, "clock-environment.mjs"),
            `import {builtinEnvironments} from 'vitest/runtime'; import {runInContext} from 'node:vm'; export default {...builtinEnvironments.node, async setupVM(...args) {const env=await builtinEnvironments.node.setupVM(...args); runInContext("const now=Date.now; Date.now=()=>Math.floor(now()/100)*100",env.getVmContext()); return env;}};`,
          );
        const configFile = join(f.root, "vitest.config.ts");
        const config = await readFile(configFile, "utf8");
        await writeFile(
          configFile,
          config.replace(
            "retry: 1",
            `retry: 1, pool: ${JSON.stringify(pool)}, ${pool.startsWith("vm") ? 'environment: "./clock-environment.mjs",' : ""} execArgv: ${JSON.stringify([`--import=${pathToFileURL(preload).href}`])}`,
          ),
        );
        await writeFile(
          f.file,
          (await readFile(f.file, "utf8")).replace(
            "expect(2+2)",
            "expect(globalThis.pulsePreload).toBe(true); expect(2+2)",
          ),
        );
        const command = launch(f, "vitest", false, { gated: true });
        const partial = await until(f, async () => {
          const [run] = await runs(f);
          return run?.tests.some(
            (test) => test.title === "passes" && test.status === "passed",
          ) && !run.endedAt
            ? run
            : false;
        });
        assert.equal(partial.status, "running");
        await command.release();
        const result = await command.done;
        assert.equal(result.code, 1, result.text);
        const [final] = await runs(f);
        assert.equal(final.failed, 1);
        assert.equal(final.flaky, 1);
        assert.equal(final.completed, final.total);
      },
    );
