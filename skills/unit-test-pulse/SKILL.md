---
name: unit-test-pulse
description: Run and inspect Vitest, Jest, and Node.js built-in unit tests with live progress, stack traces, and logs in the Unit Test Pulse Paseo panel. Use when the user asks to use Unit Test Pulse or monitor JavaScript/TypeScript unit tests through the plugin.
---

# Unit Test Pulse

Use the helper installed by the Paseo plugin:

```sh
node ~/.local/share/unit-test-pulse/cli.mjs doctor --project /absolute/project/path
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project/path --runner vitest -- --testNamePattern 'example'
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project/path --runner jest -- --runInBand
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project/path --runner node -- --test-name-pattern 'example' tests/example.test.mjs
```

Inspect package scripts and configuration first. Preserve the project's normal environment, loaders, startup tasks, and test selection. This helper launches the installed Vitest/Jest runner directly, or its own Node.js executable for built-in tests; it does not execute package-script prerequisites. Do not substitute it for a script with required setup until that setup is retained. Do not edit test configuration or install runner dependencies merely to enable monitoring.

Use `--workspace /absolute/workspace` when the test project is nested inside the Paseo workspace. Add helper `--watch` before `--` only when the user requests an ongoing watcher. Use a terminal or supervised process for a watcher and stop it when the task is finished. Never imply an idle watcher means tests are still executing.

Arguments after `--` are native runner arguments. For alternate configurations, pass `--config path` after `--`. This build targets Vitest 4.x/5.x, Jest 30.x, and the Node.js 22.18+/24 built-in test runner; tested versions are recorded in the README. Use `--runner node` for `node --test` suites, including `node:test`, `node:assert/strict`, and other assertions inside Node tests. Node options must precede file paths; do not pass the `node` executable or package-script name after `--`. Preserve `--import` / `--require` loaders and any `NODE_OPTIONS`; native reporters and destinations are retained. TypeScript support comes from the Node runtime or the project's loader. No test-framework package is needed. A Node watch cycle contains only re-executed files, and ordered reporting may delay later concurrent results. Other independent runners require a future adapter. Already running uninstrumented commands cannot be attached.

The helper prints an explicit run ID for each cycle. Read the matching result rather than guessing which concurrent run is latest:

```sh
node ~/.local/share/unit-test-pulse/cli.mjs show --project /absolute/project/path --run-id ID
node ~/.local/share/unit-test-pulse/cli.mjs logs --project /absolute/project/path --run-id ID
node ~/.local/share/unit-test-pulse/cli.mjs logs --project /absolute/project/path --run-id ID --test-id TEST_ID
```

Log reads return a page and `next` cursor. Pass `--cursor N` for the next page; `--search TEXT` filters captured output. `show` includes full captured diagnostics, counts, completeness notices, exit code, and signal. Copy only the context needed to explain a failure. Logs may contain secrets.

Per-test console attribution is available only when the runner supplies a test identity. Jest console buffers are file-scoped and may arrive at file completion; Node output and diagnostics are file-scoped when the runner supplies file identity; unassigned stdout/stderr belongs to the run. Empty scoped logs are not proof that no output was produced. Intermediate retry failures may be unavailable even when a final retry count is known.

A failed, interrupted, empty, or error run is not successful verification. Check final process exit and capture/collection notices as well as test counts. No-test or skip/todo-only runs must be reported explicitly. Preserve the helper's actual exit code.
