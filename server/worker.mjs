import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { vitestReporter } from "./vitest-reporter.mjs";
import { launchNode } from "./node-runner.mjs";
import { launchMocha } from "./mocha-runner.mjs";
import { launchJasmine } from "./jasmine-runner.mjs";
import { launchBun } from "./bun-runner.mjs";
import { plainError } from "./model.mjs";
const payload = JSON.parse(process.env.UNIT_TEST_PULSE_PAYLOAD);
delete process.env.UNIT_TEST_PULSE_PAYLOAD;
import send from "./channel.cjs";
const require = createRequire(join(payload.projectRoot, "package.json"));
let close = async () => {},
  closing = false,
  fatal = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    send({ type: "interrupted" });
    const timeout = setTimeout(() => process.exit(130), 3000);
    timeout.unref();
    await close(signal).catch(() => {});
    await send.flush();
    process.exit(130);
  });
try {
  if (payload.runner === "vitest") {
    process.env.TEST = "true";
    process.env.VITEST = "true";
    process.env.NODE_ENV ??= "test";
    const api = await import(
      pathToFileURL(require.resolve("vitest/node")).href
    );
    const { filter, options } = api.parseCLI(["vitest", ...payload.args]);
    if (
      options.help ||
      options.version ||
      options.list ||
      options.mergeReports ||
      options.clearCache
    )
      throw new Error(
        "Use the native runner for help, listing, cache management, and report merging.",
      );
    options.includeTaskLocation ??= true;
    options.watch = payload.watch;
    options.run = !payload.watch;
    const resolvedOptions = {
      ...options,
      root: options.root || payload.projectRoot,
    };
    const ctx = payload.version.startsWith("4.")
      ? await api.createVitest("test", resolvedOptions)
      : await api.createVitest(resolvedOptions);
    close = () => ctx.close();
    const reporter = vitestReporter(send);
    const progressPreload = `--import=${new URL("./vitest-progress-loader.mjs", import.meta.url).href}`;
    const attach = () => {
      if (!ctx.reporters.includes(reporter)) ctx.reporters.push(reporter);
      for (const project of ctx.projects) {
        const args = project.config.execArgv || [];
        if (!args.includes(progressPreload))
          project.config.execArgv = [progressPreload, ...args];
      }
    };
    attach();
    ctx.onAfterSetServer(async () => {
      attach();
      await ctx.start(filter);
    });
    try {
      await ctx.start(filter);
    } catch (error) {
      if (error?.code !== "VITEST_FILES_NOT_FOUND") {
        send({ type: "error", error: plainError(error) });
        console.error(error);
        process.exitCode = 1;
      }
    }
    if (!payload.watch) await ctx.close();
  } else if (payload.runner === "jasmine") {
    const jasmine = launchJasmine(payload, send);
    close = jasmine.close;
    const result = await jasmine.done;
    if (result.signal) send({ type: "interrupted" });
    process.exitCode = result.code ?? 130;
  } else if (payload.runner === "bun") {
    const bun = launchBun(payload, send);
    close = bun.close;
    const result = await bun.done;
    if (result.signal) send({ type: "interrupted" });
    process.exitCode = result.code ?? 130;
  } else if (payload.runner === "mocha") {
    const mocha = launchMocha(payload, send);
    close = mocha.close;
    const result = await mocha.done;
    if (result.signal) send({ type: "interrupted" });
    process.exitCode = result.code ?? 130;
  } else if (payload.runner === "node") {
    const node = launchNode(payload, send);
    close = node.close;
    const result = await node.done;
    if (result.signal) send({ type: "interrupted" });
    process.exitCode = result.code ?? 130;
  } else if (payload.runner === "jest") {
    process.env.NODE_ENV ??= "test";
    const jestRequire = createRequire(require.resolve("jest/package.json"));
    const cli = jestRequire("jest-cli");
    const { runCLI } = jestRequire("@jest/core");
    const argv = await cli.buildArgv(payload.args);
    if (
      argv.help ||
      argv.version ||
      argv.showConfig ||
      argv.listTests ||
      argv.clearCache
    )
      throw new Error(
        "Use the native runner for help, listing, configuration display, and cache management.",
      );
    argv.testLocationInResults ??= true;
    const temp = mkdtempSync(join(tmpdir(), "unit-test-pulse-jest-"));
    close = async () => rmSync(temp, { recursive: true, force: true });
    process.once("exit", () => rmSync(temp, { recursive: true, force: true }));
    // The original config is loaded through Jest's own loader. Its normalized root
    // stays anchored to that config even though this composition wrapper is external.
    const configModule = jestRequire.resolve("jest-config");
    const originalConfig = argv.config ?? null;
    const reporters = argv.reporters ?? null;
    const normalizeArgs = { ...argv };
    delete normalizeArgs.reporters;
    delete normalizeArgs.config;
    writeFileSync(
      join(temp, "jest.config.cjs"),
      `module.exports = async () => {\nconst {readInitialOptions, normalize} = require(${JSON.stringify(configModule)});\nconst loaded = await readInitialOptions(${JSON.stringify(originalConfig)}, {packageRootOrConfig:${JSON.stringify(payload.projectRoot)}});\nconst normalized = await normalize({...loaded.config}, ${JSON.stringify(normalizeArgs)}, loaded.configPath);\nconst reporters = ${JSON.stringify(reporters)} || normalized.options.reporters || ['default'];\nreturn {...loaded.config, reporters:[...reporters, ${JSON.stringify(fileURLToPath(new URL("./jest-reporter.cjs", import.meta.url)))}]};\n};\n`,
      { mode: 0o600 },
    );
    delete argv.reporters;
    argv.config = join(temp, "jest.config.cjs");
    if (payload.watch) {
      argv.watchAll = !argv.watch;
    } else {
      argv.watch = false;
      argv.watchAll = false;
    }
    try {
      const { results, globalConfig } = await runCLI(
        argv,
        argv.projects?.length ? argv.projects : [payload.projectRoot],
      );
      if (results)
        process.exitCode = results.success
          ? 0
          : (globalConfig.testFailureExitCode ?? 1);
    } finally {
      if (!payload.watch) rmSync(temp, { recursive: true, force: true });
    }
  } else {
    throw new Error(`Unknown runner: ${payload.runner}`);
  }
} catch (error) {
  fatal = true;
  send({ type: "error", error: plainError(error) });
  console.error(error);
  process.exitCode = 1;
}
if (!payload.watch || fatal) {
  await send.flush();
  if (process.connected) process.disconnect();
}
