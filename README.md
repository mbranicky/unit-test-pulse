# Unit Test Pulse

Follow JavaScript and TypeScript unit tests in Paseo while an agent works. Inspect live results grouped by test file, assertion failures, stack traces, current source, and captured output from the same panel.

**Status:** first working implementation, version 0.1.0. Vitest and Jest monitoring is implemented. This is an early build with the tested compatibility described below; the broader [product specification](spec.md) remains the roadmap.

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
```

Arguments after `--` belong to the runner, including `--config` for alternate configurations. For ongoing monitoring, add helper `--watch` before `--`. When the tested package is nested in a Paseo workspace, add `--workspace /absolute/workspace` before `--`.

The helper launches the existing installed runner directly. Preserve environment variables, loaders, application startup, and prerequisites from the project's usual package scripts. It does not execute those prerequisites or install dependencies in monitored projects. A running command must already be instrumented to publish results; arbitrary uninstrumented processes cannot be attached.

## Dashboard and diagnostics

- Recent runs keeps independent executions and watch cycles separate. A watch session displays **Watching — idle** after each cycle. Use **Follow latest run** to leave a manually selected historical result.
- The summary distinguishes clean passes, passes after retry, failures, skipped tests, todo tests, and cancellation. Test counts remain **known** until collection finishes. No-test and skip/todo-only cycles display **No executed tests**.
- File cards preserve full counts while filters and search narrow the displayed tests. Details are paged in groups of 200; select a file to browse its tests. The panel lists 30 recent runs; the helper can list all retained runs.
- Expand a test for its failure message, **Stack trace & details**, and **Logs**. Reports include captured errors, available diffs, runner/project identity, retry information, and an output excerpt. **Run report** also lists the slowest captured test durations.
- Click a filename for a read-only preview of its current contents with line numbers. The file may have changed since execution. Source reads are restricted to files reported by the run, within the selected workspace, up to 1 MiB.
- **Run output** contains stdout/stderr plus separately captured console records. Log views support text search, stream filters, following the latest 100 records, pausing to browse pages, and copying a page.
- The workspace header indicates active runs and recent outcomes even when the panel is closed.

Console records carry only identities provided by the runner. Vitest can supply test-attributed output. Jest console buffers, when supplied, are file-scoped and may arrive at file completion; stdout/stderr remains run-scoped. Silent mode and custom environments can suppress console records. Empty test logs do not establish that a test produced no process output. The separate capture views can contain repeated text.

Retry counts and final errors are preserved when provided. Intermediate attempt details may be unavailable. A failing coverage threshold, configuration, import, teardown, or runner process must remain visible even when reported assertions passed.

## Compatibility

| Component            | Integration target      | Verified locally |
| -------------------- | ----------------------- | ---------------- |
| Paseo app and daemon | `>=0.11.2 <0.12.0`      | 0.11.2 on macOS  |
| Helper Node.js       | `^22.18.0` or `^24.0.0` | 24.16.0          |
| Vitest               | 4.x and 5.x             | 4.1.11 and 5.0.4 |
| Jest                 | 30.x                    | 30.5.2           |

The helper rejects other runner majors. Other releases within these majors are integration targets, not separately verified compatibility claims. Vitest 4 is installed in an isolated development fixture to avoid mixing incompatible optional peers with Vitest 5.

Real-runner checks cover partial results, assertion errors, test logs, retries, skip/todo, native-versus-monitored reporter/configuration behavior, watch reruns, startup errors, concurrent commands, and interruption. All 13 unit checks and 16 real-runner integration checks passed with Node 22.18.0 and 24.16.0. The live Paseo dark-theme panel was checked at approximately 320 px, including stack/diff reports, test logs, source previews, and filtering. Light-theme and native mobile visual checks remain pending.

The compatibility suite also checks duplicate and parameterized titles, a nested Jest configuration with a preset reporter, custom environment and TypeScript transform, and a Jest coverage-threshold failure.

Browser-mode tests, multi-project configurations, configuration-file changes during watching, different operating systems, and native mobile clients need additional verification. The client follows Paseo's cross-platform component rules, but that alone is not a mobile compatibility test.

## Local data and limits

Results and captured output stay under `~/.local/state/unit-test-pulse` on the daemon host. Use `UNIT_TEST_PULSE_STATE_DIR` or helper `--state-dir PATH` to override it; helper and daemon must share the same location. Helper runtime files live under `~/.local/share/unit-test-pulse`.

Process output and structured console logs each have a 20 MiB capture budget per cycle, including serialized record overhead. Individual log records are limited to 256 KiB. Console collection also drops records with a visible notice if its communication queue is overloaded. Result collection continues after output capture stops. Log reads have a 64 MiB bound and result/source/report reads have their own explicit limits.

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

The development fixture under `examples/vitest` deliberately contains one failing assertion and a pass on retry. It provides real panel data without changing another project:

```sh
node server/cli.mjs run --project examples/vitest --workspace "$PWD" --runner vitest
```

A nonzero exit is expected from that demonstration.

The runtime helper uses Node's standard library and the monitored project's installed runner. Paseo provides the panel's runtime libraries. Test runners and SDK tooling are development dependencies; there are no shipped npm runtime dependencies.

Advanced historical comparisons, failure grouping, coverage summaries, report imports, configurable retention, and adapters for other runners remain planned. See [the implementation plan](implementation-plan.md).

Based on the design and selected utility components of [Cypress Pulse](https://github.com/mbranicky/cypress-pulse), with its MIT attribution preserved. [MIT license](LICENSE).
