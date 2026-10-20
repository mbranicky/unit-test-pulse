# Adapter examples

Small demo projects for every supported runner. Each folder contains a shopping-cart suite with an intentional welcome-discount failure and a separate passing pricing suite. The short inventory-service delay makes live progress visible. Use these examples to inspect file grouping, nested suites, failure details, source previews, logs, and native runner behavior in Unit Test Pulse.

## Setup

From the repository root, install the development dependencies once:

```sh
npm ci --ignore-scripts
npm run setup:compat
```

The examples use the runners installed at the repository root. They do not need separate installs or lockfiles. Use the plugin's supported Node.js runtime, 22.18+ or 24.x. The compatibility setup prepares the pinned Bun executable supplied by the development dependencies; a global Bun installation is optional.

## Run an example

Run these commands from the repository root:

| Adapter | Example                                                | Native run                           | Monitored run                                  |
| ------- | ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| Vitest  | [TypeScript tests](vitest/cart.test.ts)                | `npm --prefix examples/vitest test`  | `npm --prefix examples/vitest run test:pulse`  |
| Jest    | [CommonJS tests](jest/cart.test.cjs)                   | `npm --prefix examples/jest test`    | `npm --prefix examples/jest run test:pulse`    |
| Mocha   | [CommonJS and strict assertions](mocha/cart.test.cjs)  | `npm --prefix examples/mocha test`   | `npm --prefix examples/mocha run test:pulse`   |
| Bun     | [TypeScript tests](bun/cart.test.ts)                   | `npm --prefix examples/bun test`     | `npm --prefix examples/bun run test:pulse`     |
| Jasmine | [CommonJS tests and debug logs](jasmine/cart.test.cjs) | `npm --prefix examples/jasmine test` | `npm --prefix examples/jasmine run test:pulse` |
| Node.js | [ES modules and strict assertions](node/cart.test.mjs) | `npm --prefix examples/node test`    | `npm --prefix examples/node run test:pulse`    |

Open the **Unit Test Pulse** panel in the repository's Paseo workspace to inspect monitored runs. The example scripts associate their nested project with this workspace and print a run ID. Native scripts do not publish dashboard results. Neither script requires the helper to have been installed by Paseo: monitored scripts use `server/cli.mjs` from this checkout.

**Every complete demo intentionally exits unsuccessfully:** code 1 for Vitest, Jest, Mocha, Bun, and Node.js; code 3 for Jasmine. This is expected. Each run has ten tests across two files and one permanently failing assertion. The separately passing `pricing` suite provides a clean verification example.

For example, monitor only the passing Mocha file:

```sh
node server/cli.mjs run --project examples/mocha --workspace "$PWD" --runner mocha -- --no-config pricing.test.cjs
```

Mocha appends positional files to the spec glob in its configuration, so this file-only command uses `--no-config`.

For an all-passing run with another adapter, select that example's `pricing.test.*` file using its native file-selection arguments. Jest also uses `--runInBand` in its demo scripts so output is easy to follow.

## What each example shows

- **Vitest:** TypeScript, an assertion diff, test-attributed logs, retry success, skipped/todo tests, and async progress. Its configuration retries failures once.
- **Jest:** CommonJS, an assertion diff, file-scoped console output, an immediate retry success, skipped/todo tests, and async progress. The permanent failure also receives its configured retry.
- **Mocha:** Strict assertion expected/actual values, per-test retries, skipped and pending declarations, nested suites, and async progress. Both skipped and pending declarations appear as **Skipped**. Process output is available in **Run output**.
- **Bun:** TypeScript, native per-test retries, skipped/todo tests, and async progress. Failure diagnostics and console output are available in **Run output**, since Bun does not supply their owning test identities.
- **Jasmine:** Failure messages and stacks, a test-scoped `jasmine.debugLog()` message, disabled/pending specs, nested suites, and async progress. Both disabled and pending specs appear as **Skipped**. Ordinary console output remains in **Run output**. The inventory lookup passes directly because Jasmine has no native retries.
- **Node.js:** Dependency-free `node:test` with `node:assert/strict`, original assertion details, skipped/todo tests, nested suites, and async progress. Runner-supplied output is file-scoped; the inventory lookup passes directly without simulated retries.

Every `pricing` file has four passing tests, including a nested shipping suite. The cart's welcome-discount assertion compares an undiscounted total of 59.97 with the expected 53.97, intentionally leaving a useful failure to inspect. Source previews read the current example files.

For a watcher, pass helper `--watch` before `--`, for example:

```sh
node server/cli.mjs run --project examples/mocha --workspace "$PWD" --runner mocha --watch
```

Stop the watcher when finished. Vitest, Jest, Mocha, Bun, and Node support the helper's watch mode; Jasmine uses one-shot runs. To select a different existing Bun runtime, set `UNIT_TEST_PULSE_BUN_BIN=/absolute/path/to/bun` for the monitored command.

The parent [README](../README.md) describes adapter compatibility, capture limits, and reporting limitations. The examples use the 1.0.0 adapter behavior; each native retry remains one captured test.
