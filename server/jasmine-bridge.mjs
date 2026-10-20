import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import cluster from "node:cluster";
import { jasmineReporter } from "./jasmine-reporter.mjs";
import { plainError } from "./model.mjs";

// The native CLI owns configuration, helpers, loaders, reporters, and exit policy.
// This preload runs in cluster workers too; observe only the parent dispatcher.
if (cluster.isPrimary) {
  const entry = process.env.UNIT_TEST_PULSE_JASMINE_ENTRY;
  const require = createRequire(entry);
  const publish = (event) =>
    appendFileSync(
      process.env.UNIT_TEST_PULSE_JASMINE_JOURNAL,
      `${JSON.stringify(event)}\n`,
    );
  for (const [Runner, parallel] of [
    [require(entry), false],
    [require(join(dirname(entry), "parallel_runner.js")), true],
  ]) {
    const execute = Runner.prototype.execute;
    Runner.prototype.execute = async function (...args) {
      const loadSpecs = this.loadSpecs;
      if (parallel)
        this.addReporter(jasmineReporter(publish, { parallel: true }));
      else {
        // Helpers and specs may clear or replace reporters. Attach after loading,
        // through the public environment API; Jasmine 7 freezes its core objects.
        this.loadSpecs = async function (...loadArgs) {
          await loadSpecs.apply(this, loadArgs);
          this.env.addReporter(
            jasmineReporter(publish, { tree: this.env.topSuite() }),
          );
        };
      }
      try {
        return await execute.apply(this, args);
      } catch (error) {
        publish({ type: "error", error: plainError(error) });
        throw error;
      } finally {
        if (!parallel) this.loadSpecs = loadSpecs;
      }
    };
  }
}
