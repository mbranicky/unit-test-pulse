---
name: unit-test-pulse
description: Run and inspect Vitest, Jest, Mocha, Bun, and Node.js built-in unit tests with live progress, stack traces, and logs in the Unit Test Pulse Paseo panel. Use when the user asks to use Unit Test Pulse or monitor JavaScript/TypeScript unit tests through the plugin.
---

# Unit Test Pulse

Use the helper installed by the Paseo plugin:

```sh
node ~/.local/share/unit-test-pulse/cli.mjs doctor --project /absolute/project/path
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project/path --runner vitest -- --testNamePattern 'example'
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project/path --runner jest -- --runInBand
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project/path --runner mocha -- --grep 'example'
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project/path --runner bun -- --test-name-pattern 'example'
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project/path --runner node -- --test-name-pattern 'example' tests/example.test.mjs
```

Inspect package scripts and configuration first. Preserve the project's normal environment, loaders, startup tasks, and test selection. This helper launches the installed Vitest/Jest/Mocha runner directly, an explicitly selected Bun executable, or its own Node.js executable for built-in tests; it does not execute package-script prerequisites. Do not substitute it for a script with required setup until that setup is retained. Do not edit test configuration or install runner dependencies merely to enable monitoring.

Use `--workspace /absolute/workspace` when the test project is nested inside the Paseo workspace. Add helper `--watch` before `--` only when the user requests an ongoing watcher. Use a terminal or supervised process for a watcher and stop it when the task is finished. Never imply an idle watcher means tests are still executing.

Arguments after `--` are native runner arguments. For alternate configurations, pass `--config path` after `--`. This build targets Vitest 4.x/5.x, Jest 30.x, Mocha 11.x/12.x, Bun 1.4.x from 1.4.3, and the Node.js 22.18+/24 built-in test runner; tested versions are recorded in the README. Use `--runner node` for `node --test` suites, including `node:test`, `node:assert/strict`, and other assertions inside Node tests. Node options must precede file paths; do not pass the `node` executable or package-script name after `--`. Preserve `--import` / `--require` loaders and any `NODE_OPTIONS`; native reporters and destinations are retained. TypeScript support comes from the Node runtime or the project's loader. No test-framework package is needed. A Node watch cycle contains only re-executed files, and ordered reporting may delay later concurrent results. Other independent runners require a future adapter. Already running uninstrumented commands cannot be attached.

For Mocha, preserve native CLI options, `.mocharc` / package configuration, existing reporter settings, preloads, and loaders. Use `--runner mocha`; use helper `--watch` for a watcher (native `--watch` / `-w` also enables it). Otherwise the helper selects one-shot mode. Parallel results are buffered until file completion. Pending and skipped declarations both appear as skipped. Process output is run-scoped; use Run output or unfiltered `logs`, not per-test logs, to inspect it. Source previews use unambiguous title paths because Mocha supplies no declaration locations. Dry runs are not executed verification.

For Bun, explicitly select `--runner bun`. `doctor` searches the project-local executable and PATH; `UNIT_TEST_PULSE_BUN_BIN=/absolute/path/to/bun` selects another existing runtime. Preserve bunfig configuration, `.env` files, preloads, test filters, reporter destinations, and startup prerequisites. Do not install Bun or change project files merely to monitor tests. Use helper `--watch` or native `--watch` for a watcher. `--parallel`, `--hot`, inspector flags and `BUN_INSPECT*` settings are rejected: Bun parallel workers do not expose the required events, and monitoring owns a private loopback inspector. Concurrent tests within one process are supported. All console/error diagnostics are run-scoped, including diffs and available stack frames; use unfiltered `logs` / Run output, not a guessed test owner. Test details retain status and source previews, with an explanation when error attribution is unavailable. Some Bun assertion errors carry no stack frames. Missing results are incomplete capture, never successful verification.

The helper prints an explicit run ID for each cycle. Read the matching result rather than guessing which concurrent run is latest:

```sh
node ~/.local/share/unit-test-pulse/cli.mjs show --project /absolute/project/path --run-id ID
node ~/.local/share/unit-test-pulse/cli.mjs logs --project /absolute/project/path --run-id ID
node ~/.local/share/unit-test-pulse/cli.mjs logs --project /absolute/project/path --run-id ID --test-id TEST_ID
```

Log reads return a page and `next` cursor. Pass `--cursor N` for the next page; `--search TEXT` filters captured output. `show` includes full captured diagnostics, counts, completeness notices, exit code, and signal. Copy only the context needed to explain a failure. Logs may contain secrets.

Per-test console attribution is available only when the runner supplies a test identity. Jest console buffers are file-scoped and may arrive at file completion; Node output and diagnostics are file-scoped when the runner supplies file identity; unassigned stdout/stderr belongs to the run. Empty scoped logs are not proof that no output was produced. Intermediate retry failures may be unavailable even when a final retry count is known.

A failed, interrupted, empty, or error run is not successful verification. Check final process exit and capture/collection notices as well as test counts. No-test or skip/todo-only runs must be reported explicitly. Preserve the helper's actual exit code.
