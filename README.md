# Unit Test Pulse

Follow JavaScript and TypeScript unit tests in Paseo while an agent works. Inspect live results grouped by test file, assertion failures, stack traces, current source, and captured output from the same panel.

**Status:** early build, version 0.3.0, with live Vitest, Jest, and Node.js test-runner monitoring. Tested versions and current limitations are listed below.

## Get started

Install the local checkout:

```sh
paseo plugin install /absolute/path/to/unit-test-pulse
```

Open **Unit Test Pulse** in a workspace through the Command Center. Choose **Install skill** to make its instructions available to new agent sessions. Existing skill files owned by another installation are left unchanged.

For example: “Use Unit Test Pulse to run the unit tests, preserving this project's usual environment and test selection.”

The plugin installs a dependency-free helper on the daemon host:

```sh
node ~/.local/share/unit-test-pulse/cli.mjs doctor --project /absolute/project
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project --runner vitest -- --testNamePattern 'example'
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project --runner jest -- --runInBand
node ~/.local/share/unit-test-pulse/cli.mjs run --project /absolute/project --runner node -- --test-name-pattern 'example' tests/example.test.mjs
```

Arguments after `--` belong to the runner, including `--config` for alternate configurations. For ongoing monitoring, add helper `--watch` before `--`. When the tested package is nested in a Paseo workspace, add `--workspace /absolute/workspace` before `--`.

The helper launches the existing installed runner directly, or the helper's Node.js executable for `--runner node`. Preserve environment variables, loaders, application startup, and prerequisites from the project's usual package scripts. It does not execute those prerequisites or install dependencies in monitored projects. A running command must already be instrumented to publish results; arbitrary uninstrumented processes cannot be attached.

## Node.js built-in tests

Use `--runner node` for tests run with `node --test`, including `node:test` / `node:assert/strict`, `node:assert`, and assertion libraries that throw errors inside Node tests. No test-framework dependency is needed. ESM, CommonJS, `describe()` / `it()`, `test()`, context subtests, callback tests, skip/todo, and assertion-only files executed by Node are supported. TypeScript uses the selected Node runtime's own type stripping or the project's existing loader; monitoring does not add a transpiler.

Put native Node options before file paths, just as with `node --test`. The helper adds `--test` automatically; `--import`, `--require`, `--test-name-pattern`, file selection, concurrency, coverage options, and existing reporters/destinations keep their native meaning. Reporter settings in `NODE_OPTIONS` are also preserved. Use helper `--watch` before `--` for an ongoing watcher. A Node watch cycle records only the files that Node re-executes, so an unchanged file is absent from later cycles.

`doctor` always lists the available built-in runner. If no Vitest/Jest package is installed, an omitted `--runner` selects Node.js. An existing single installed Vitest or Jest runner remains the default; use an explicit selection when several are installed.

Node assertion reports keep the original assertion stack and formatted expected/actual values. Output and diagnostics supplied by Node carry file identity, not individual test ownership. Test results follow Node's declaration-ordered reporting, so an earlier slow concurrent test can delay later results. An unmatched name filter is shown as no executed tests, even when Node also reports a successful file wrapper. Separate adapters are still required for Mocha, AVA, Tape, and other independent runners.

## Dashboard and diagnostics

- Recent runs keeps independent executions and watch cycles separate. A watch session displays **Watching — idle** after each cycle. Use **Follow latest run** to leave a manually selected historical result.
- The summary distinguishes clean passes, passes after retry, failures, skipped tests, todo tests, and cancellation. Test counts remain **known** until collection finishes. No-test and skip/todo-only cycles display **No executed tests**.
- File cards preserve full counts while filters and search narrow the displayed tests. Details are paged in groups of 200; select a file to browse its tests. The panel lists 30 recent runs; the helper can list all retained runs.
- Expand a test for its failure message, **Stack trace & details**, and **Logs**. Reports include captured errors, available diffs, runner/project identity, retry information, and an output excerpt. **Run report** also lists the slowest captured test durations.
- **Test details** shows the selected `it()` / `test()` declaration above its report, with original line numbers, **Copy source**, and **Open full file**. Nested suites, standard modifiers, aliases imported from Vitest/Jest/Node, CommonJS Node aliases, context subtests, and parameterized tests with runner locations are supported. Older runs use an unambiguous title-path match. Generated/custom declarations that cannot be matched show an explanation and full-file access.
- Click a filename for a read-only preview of its current contents with line numbers. The file may have changed since execution. Source reads are restricted to files reported by the run, within the selected workspace, up to 1 MiB.
- **Run output** contains stdout/stderr plus separately captured console records. Log views support text search, stream filters, following the latest 100 records, pausing to browse pages, and copying a page.
- The workspace header indicates active runs and recent outcomes even when the panel is closed.

Console records carry only identities provided by the runner. Vitest can supply test-attributed output. Jest console buffers, when supplied, are file-scoped and may arrive at file completion; Node.js stdout/stderr and diagnostics supplied by the runner are file-scoped. Unassigned process stdout/stderr remains run-scoped. Silent mode and custom environments can suppress console records. Empty test logs do not establish that a test produced no process output. The separate capture views can contain repeated text.

Retry counts and final errors are preserved when provided. Intermediate attempt details may be unavailable. A failing coverage threshold, configuration, import, teardown, or runner process must remain visible even when reported assertions passed.

## Compatibility

| Component            | Integration target      | Verified locally    |
| -------------------- | ----------------------- | ------------------- |
| Paseo app and daemon | `>=0.11.2 <0.12.0`      | 0.11.2 on macOS     |
| Helper Node.js       | `^22.18.0` or `^24.0.0` | 24.16.0             |
| Vitest               | 4.x and 5.x             | 4.1.11 and 5.0.4    |
| Jest                 | 30.x                    | 30.5.2              |
| Node.js test runner  | 22.18+ and 24.x         | 22.18.0 and 24.16.0 |

Vitest 4.1.11 and 5.0.4 contain a task-update timer edge case that can leave completed tests queued until another event or file completion. For the recognized affected implementation, the helper adds a worker preload that repairs only that timer in memory. Project files and installed dependencies are not edited; existing worker preloads are preserved. Unknown or already-fixed implementations are left unchanged. Vitest's VM module cache is bridged into the same scoped repair. Regression checks cover exact timer boundaries in fork, thread, and VM pools.

The helper rejects other runner majors. Other releases within these majors are integration targets, not separately verified compatibility claims. Vitest 4 is installed in an isolated development fixture to avoid mixing incompatible optional peers with Vitest 5.

Real-runner checks cover partial results, assertion errors, test logs, retries, skip/todo, native-versus-monitored reporter/configuration behavior, watch reruns, startup errors, concurrent commands, and interruption. The unit and real-runner integration checks passed with Node 22.18.0 and 24.16.0. The live Paseo dark-theme panel was checked at approximately 320 px, including stack/diff reports, test logs, source previews, and filtering. Light-theme and native mobile visual checks remain pending.

Node integration checks also cover ESM/CommonJS/TypeScript and assertion-only files without project dependencies, native reporter destinations and preloads, nested and duplicate titles, strict assertion values, source selection, watch cycles, interruption, timeouts, cancellation, and empty selections.

The compatibility suite also checks duplicate and parameterized titles, per-test source selection, a nested Jest configuration with a preset reporter, custom environment and TypeScript transform, and a Jest coverage-threshold failure. Source extraction checks cover nested suites, imported aliases, modifiers, JSX, original line numbers, ambiguous declarations, and workspace boundaries.

Browser-mode tests, multi-project configurations, configuration-file changes during watching, different operating systems, and native mobile clients need additional verification. The client follows Paseo's cross-platform component rules, but that alone is not a mobile compatibility test.

## Local data and limits

Results and captured output stay under `~/.local/state/unit-test-pulse` on the daemon host. Use `UNIT_TEST_PULSE_STATE_DIR` or helper `--state-dir PATH` to override it; helper and daemon must share the same location. Helper runtime files live under `~/.local/share/unit-test-pulse`.

Process output and structured console logs each have a 20 MiB capture budget per cycle, including serialized record overhead. Individual log records are limited to 256 KiB. Console collection also drops records with a visible notice if its communication queue is overloaded. Result collection continues after output capture stops. Log reads have a 64 MiB bound and result/source/report reads have their own explicit limits.

Runs whose project or worktree folder has been removed are omitted from workspace history without generating warnings. Their saved results are retained under the normal history policy. Missing records during cleanup are also skipped; damaged records and unexpected read errors still produce notices.

Completed history is cleaned up on cycle rollover and helper exit, keeping the latest 100 cycles per project within a 500 MiB completed-history budget where possible. Active and idle-watch records are preserved. This first build does not impose a hard global budget on all simultaneous active runs. Capture and retention settings are informational and fixed for now.

Captured logs can contain application secrets. The plugin does not record the full environment and does not claim automatic secret removal. Copy and export actions use captured text; no cloud service or extra account is required.

For agent-readable results:

```sh
node ~/.local/share/unit-test-pulse/cli.mjs list --project /absolute/project
node ~/.local/share/unit-test-pulse/cli.mjs show --project /absolute/project --run-id ID
node ~/.local/share/unit-test-pulse/cli.mjs logs --project /absolute/project --run-id ID --test-id TEST_ID
```

Log reads return `next` when another page exists; pass it as `--cursor N`. `--search TEXT` filters captured output. Keep the explicit run ID when several commands run concurrently.

## Development

```sh
npm ci --ignore-scripts
npm run setup:compat
npm run check
npm run test:integration
paseo plugin reload unit-test-pulse
```

Live-progress integration checks hold a fixture test open until the observer has read persisted partial results. Delayed observation and staggered command startup exercise the former timing race without requiring a short overlap window. Polling stops when a runner exits unexpectedly and includes its output and the last snapshots in failures. Child processes are stopped before temporary fixture data is removed.

The development fixture under `examples/vitest` deliberately contains one failing assertion and a pass on retry. It provides real panel data without changing another project:

```sh
node server/cli.mjs run --project examples/vitest --workspace "$PWD" --runner vitest
```

A nonzero exit is expected from that demonstration.

The runtime helper uses Node's standard library and, for Vitest/Jest, the monitored project's installed runner. Paseo provides the panel's runtime libraries. The plugin uses TypeScript as a runtime dependency to parse test declarations for source previews without executing the source. Test runners and SDK tooling are development dependencies.

Advanced historical comparisons, failure grouping, coverage summaries, report imports, configurable retention, and adapters for other runners are not implemented yet.

Based on the design and selected utility components of [Cypress Pulse](https://github.com/mbranicky/cypress-pulse), with its MIT attribution preserved. [MIT license](LICENSE).
