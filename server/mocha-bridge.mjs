import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { attachMochaReporter } from "./mocha-reporter.mjs";
import { plainError } from "./model.mjs";

// Mocha loads this alongside the user's --require modules. Its native CLI still
// owns configuration, loaders, reporters, watch behavior, and exit policy.
if (process.env.MOCHA_WORKER_ID === undefined) {
  const require = createRequire(process.env.UNIT_TEST_PULSE_MOCHA_PACKAGE);
  const packageFile = process.env.UNIT_TEST_PULSE_MOCHA_PACKAGE;
  const { main = "index.js" } = require(packageFile);
  const { default: Mocha } = await import(
    pathToFileURL(resolve(dirname(packageFile), main)).href
  );
  const publish = (event) =>
    appendFileSync(
      process.env.UNIT_TEST_PULSE_MOCHA_JOURNAL,
      `${JSON.stringify(event)}\n`,
    );
  // Mocha 11 can swallow global fixture errors after its runner has ended.
  // Observe the failure and rethrow it without changing Mocha's exit policy.
  for (const name of ["runGlobalSetup", "runGlobalTeardown"]) {
    const fixture = Mocha.prototype[name];
    Mocha.prototype[name] = async function (...args) {
      try {
        return await fixture.apply(this, args);
      } catch (error) {
        publish({ type: "error", error: plainError(error) });
        throw error;
      }
    };
  }
  const original = Mocha.prototype.run;
  Mocha.prototype.run = function (...args) {
    const Reporter = this._reporter;
    // Attach before execution starts; return the existing reporter object so its
    // async done() callback and every reporter option retain native behavior.
    this._reporter = function (runner, options) {
      attachMochaReporter(runner, Mocha.Runner.constants, publish, {
        files: options.files,
        dryRun: Boolean(options.dryRun),
        watch: process.env.UNIT_TEST_PULSE_MOCHA_WATCH === "1",
      });
      return new Reporter(runner, options);
    };
    try {
      return original.apply(this, args);
    } finally {
      this._reporter = Reporter;
    }
  };
}
