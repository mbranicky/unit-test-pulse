# Unit Test Pulse — Product Specification

> **Context:** A companion to Cypress Pulse for developers monitoring JavaScript and TypeScript unit tests in Paseo. This draft follows the inspected Cypress Pulse 0.5.0 project and its panel captures. The user selected the name Unit Test Pulse and confirmed reuse of the existing Paseo, React/TypeScript, and Node.js stack on 15 October 2026. Requirements below describe planned behavior, not shipped or verified capabilities.

## Overview

Unit Test Pulse shows test progress, outcomes, failures, and logs beside an agent’s work in Paseo. Developers can move from a failed run to a test’s assertion details, stack trace, and available output without searching a terminal transcript.

The dashboard uses a common test model with separate runner adapters. Vitest and Jest are the initial integrations. Additional runners join through adapters or explicit report import; “supports unit tests” does not imply that arbitrary commands expose structured live results automatically. The plugin monitors executions using the project’s installed runner and existing test configuration.

## Goals

- Show received test outcomes while execution is still in progress, with a target of two seconds from collector receipt to display under normal local conditions.
- Make captured failures, stacks, assertion diffs, and logs available from the relevant test, file, or run, with attribution and collection limits visible.
- Keep independent commands, watch cycles, runner projects, concurrent workers, and retries distinct so results and counts remain trustworthy.
- Preserve monitored projects’ sources, configuration files, dependency manifests, and existing reporter behavior.
- Keep Cypress Pulse’s visual structure and compact Explorer usability while replacing media controls with diagnostics and reporting.
- Establish a repeatable compatibility suite before advertising supported runner and host versions.

## User Roles

### Developer

- Opens the workspace panel, follows runs, filters results, inspects diagnostics and current source, and copies a failure report.
- Uses the project’s existing execution workflow, with monitoring added through the helper or a documented reporter integration.
- Accesses results through the selected Paseo host and workspace. The plugin introduces no separate account or shared-team permission system.

### Coding agent

- Uses an optional installed skill and helper to discover runners, start monitored executions, and read structured run summaries or selected diagnostics.
- Receives explicit run identifiers and completeness notices; must not interpret a partial, interrupted, or empty execution as successful verification.
- Uses the same local data and workspace boundaries as the panel. Monitoring does not automatically submit prompts or publish results elsewhere.

## Core Features

### 1. Runner discovery and honest capability reporting

The setup view detects installed test runners using the selected project directory, package metadata, and configuration. Discovery does not import project code merely to populate the panel. It displays candidates, their installed versions, and the evidence used to identify them. If several runners or configurations are plausible, the developer or agent selects one explicitly.

Each integration advertises its tested capabilities: batch execution, watch cycles, file progress, individual test progress, retries, log attribution, assertion details, and coverage. Unsupported versions receive an actionable message rather than fabricated progress. Configuration loading needed for execution happens in the runner’s normal trusted process.

Initial delivery targets Vitest and Jest batch and watch workflows using supported versions established by real integration tests. The first development milestone proves Vitest end to end; initial release readiness also requires the Jest integration. Mocha, Node’s built-in test runner, and other runners are later adapter candidates, not initial compatibility claims.

### 2. Monitored execution and setup

An external Node.js helper launches the project’s installed runner and adds a Pulse reporter alongside the effective reporters. It must preserve project configuration semantics, aliases, transforms, setup/teardown, environments, test selection, working directory, reporter options, and exit behavior. It must not install or upgrade the project’s test dependencies.

The helper supports runner selection, an explicit project/configuration, one-shot or watch mode, and runner arguments. Commands and argument names will be finalized during the compatibility spike. Test selection and run context are recorded without storing the complete environment or unfiltered command line. Arbitrary shell strings are not used to construct the monitored runner invocation.

Existing package scripts can contain environment setup, loaders, or prerequisite commands. Setup must explain which parts of that workflow need to be retained. Direct runner execution is only equivalent when verified; if a script cannot safely be instrumented, show a documented reporter integration route or an explicit limitation. Reporter composition must be demonstrated for custom and default reporters; setting an extra reporter must not silently replace the project’s reporter list. Both [Vitest](https://vitest.dev/guide/reporters) and [Jest](https://jestjs.io/docs/configuration#reporters-arraymodulename--modulename-options) document reporter configuration.

The panel includes Cypress Pulse-style **Agent setup** and opt-in **Install skill** actions, preserving ownership checks on existing skill files. Proposed identity: `unit-test-pulse`, with helper and state folders separate from Cypress Pulse. A doctor command reports installed runners, compatibility, selected configuration, and helper/state visibility.

An existing process can be observed only if it already publishes compatible telemetry. Arbitrary uninstrumented processes cannot gain reliable per-test monitoring after launch.

### 3. Familiar live dashboard

Retain the Cypress Pulse panel’s structure: a toolbar with recent runs, settings, agent setup, and refresh; run status and elapsed time; segmented progress and outcome counts; then expandable test-file cards. Use the host theme, spacing, typography, compact behavior, and activity indicator patterns. A workspace header indicator keeps active execution visible when the panel is closed.

Replace Cypress-specific browser and recording information with runner/version, project, execution mode, and watch-cycle information. Omit screenshot, gallery, video, and capture-settings controls. Place **Logs**, **Failure details**, and later **Report** actions where they are useful, without leaving empty media placeholders.

File cards show relative paths, runner-project labels when needed, counts, and elapsed duration. Active files appear first, followed by failures and then completed files. Failing and active files initially expand; user expansion choices persist during updates. Nested suite names remain visible without requiring deeply indented trees in a narrow panel.

Provide All, Failed, Flaky, and Skipped/Todo filters, plus text search across file paths and test titles. Filtering affects the list, not the run’s overall counts. Selecting a historical run remains stable when new runs arrive; a visible action returns to the active run. Parallel executions appear independently in recent runs.

For large suites, paginate or virtualize details and search on the server; run totals cover all collected results. Default to 200 test rows per page and 30 recent-run entries, with access to older retained runs. A 320 px Explorer layout must remain usable with long titles and paths.

### 4. Reliable progress, status, retries, and identity

Represent queued, running, passed, failed, skipped, todo, and cancelled tests separately. Keep any runner-native outcome alongside the normalized outcome. Expected-failure tests follow the runner’s reported verdict; the presence of an error object alone does not mean the test failed.

Maintain distinct execution state and verification outcome. A cycle can finish with passed, failed, no executed tests, interrupted, or error outcome. An exit failure caused by coverage, configuration, an import error, teardown, or a reporter must remain visible even if every reported assertion passed. Preserve exit code and signal separately from test totals. A failed cycle can contain both failed tests and infrastructure errors.

Show known test counts until collection is complete; show an indeterminate indicator when no reliable total exists. Never turn a missing count into zero or a provisional total into a percentage claiming full completion. Distinguish terminal skipped/todo tests from tests still queued. Bail, collection failures, cancellation, and worker crashes can leave tests unexecuted and must not turn those tests into passes.

Count each test once by its final result. A pass after a reported failed attempt is labeled **flaky** and appears separately from clean passes; retain attempts and retry count when available. A fail in one watch cycle followed by a pass in another is a cross-run history observation, not a retry within one execution. Runners that expose only a retry count must not imply that all intermediate errors or logs were captured.

Identity includes host/workspace scope, project root, runner project/configuration, file, suite path, and runner test ID or a deterministic disambiguator. Duplicate titles, parameterized cases, and identical paths in separate runner projects must not overwrite each other. Where cross-run matching is ambiguous, omit comparisons and explain why.

### 5. Watch sessions and concurrent execution

A watch process is a session; each execution triggered within it is a separate cycle with its own run ID. After a cycle ends, the session displays **Watching — idle** alongside the latest cycle outcome. Waiting for edits is not shown as tests still running.

Keep prior cycles immutable after final reconciliation. A rerun of a subset shows that subset’s results; tests from earlier cycles are not presented as executed in the current cycle. Expose the selected subset and whether it is known to be comparable to an earlier run.

Concurrent commands and workers use separate run/producer identities. Replayed events cannot duplicate tests, logs, or totals, and late events from a previous cycle cannot attach to the next. Runner-provided timestamps and receipt order remain distinct; parallel output has no invented global execution order.

Track collector health separately from runner health. A quiet long-running test is not a crash. If ownership/liveness cannot be confirmed, mark monitoring unavailable or stale; when process termination without a final record is confirmed, preserve partial results and mark interruption/error as appropriate. Restarting the Paseo client must not discard an instrumented session’s existing data.

### 6. Failure details and stack traces

For each captured failure, show the error name/message, full available stack, and runner-provided expected/actual values or diff. Support several errors per test and retain their order. Display hook, collection, import, unhandled-rejection, timeout, worker, and run-level failures at their actual scope, including failures that produce no test rows.

Keep raw diagnostic text available for copying. A readable view can strip terminal escape sequences and collapse framework frames, but must provide **Show full stack**. Never synthesize a diff by evaluating arbitrary error properties or executing serialized values. Snapshot mismatches appear as diagnostics; viewing a report does not update snapshots.

When the runner supplies original TypeScript locations, use them. Otherwise display the received location without promising source-map recovery. A source preview reads current workspace files and states that they may have changed since the run. Start with read-only previews and Copy location; editor navigation is conditional on a supported host API.

**Copy failure report** includes runner/version, project, test identity, result, attempt information, errors, stack, and selected captured output. Truncation and missing fields appear in the copied report as well as the UI.

### 7. Logs as a first-class diagnostic surface

Capture the monitored process’s stdout/stderr while preserving its usual terminal output. Separately ingest structured console records exposed by an adapter. The log viewer distinguishes **Test**, **File**, and **Run output**, and supports search, available severity/stream filters, follow-tail, pause scrolling, and copying a selected range or captured log.

A record has a receipt sequence, stream or known severity, text, and whichever session/cycle/project/file/test/attempt identities the producer actually supplies. Unknown timestamp, level, or attribution stays unknown. Never assign interleaved worker output to whichever test most recently started. Unattributed output belongs at run/session level. If equivalent text is also present in process output, label the two views rather than removing legitimate repeated messages through text-based deduplication.

The current [Vitest reporter interface](https://raw.githubusercontent.com/vitest-dev/vitest/main/packages/vitest/src/node/types/reporter.ts) exposes console and lifecycle hooks. Jest’s [reporter interface](https://raw.githubusercontent.com/jestjs/jest/main/packages/jest-reporters/src/types.ts) supplies test/file events, while its [test result model](https://raw.githubusercontent.com/jestjs/jest/main/packages/jest-test-result/src/types.ts) includes an optional file console buffer. These are integration leads; behavior and availability must be checked against each supported released version.

Consequently, initial Jest support guarantees captured process output, plus file console output when supplied. Live per-test console attribution is conditional on a proven integration, not a baseline promise. Do not replace the project’s custom test environment or patch application console behavior merely to claim parity. The UI states whether output is live, delivered at file completion, unavailable, or suppressed by runner settings such as silent mode.

Default proposed limits: 20 MiB of process output per cycle and a separately bounded 20 MiB watch-session buffer; 20 MiB of structured console records per cycle; 256 KiB per log record; and 1 MiB per error record. Reaching a limit stops that capture stream for the cycle, shows a notice with dropped-byte/record counts, and leaves result collection active. Apply backpressure/drop handling without blocking the runner. These limits are implementation defaults to validate with large-output fixtures, and can later be configured.

### 8. Recent history and practical reporting

The initial dashboard provides current-cycle summary, file/test durations where available, slowest files/tests, failure counts, and a copyable Markdown report. Agent reads return normalized JSON with schema version, run identity, capture completeness, and capability notices. A summary does not load every log into the response; details and log pages are requested by identity and cursor.

After reliable Vitest/Jest monitoring ships, add these reports in order:

| Report                    | Planned behavior                                                                                          | Interpretation limit                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run comparison            | New, resolved, and continuing failures; added/missing tests; wall-clock duration change                   | Default baseline is the previous completed run with matching runner/project/configuration and selection; dissimilar selection requires explicit comparison and a warning |
| Slow-test history         | Median duration and recent change for matched tests/files                                                 | Require at least five comparable samples; parallel test durations do not sum to wall-clock run duration                                                                  |
| Retry and outcome history | Pass-after-retry rate and cross-run pass/fail variability with sample counts                              | Label variability as an observation; different code revisions and environments can explain changes                                                                       |
| Failure grouping          | Group similar errors and show affected tests, with representative stacks                                  | Preserve access to each original failure; grouping does not establish a common root cause                                                                                |
| Coverage summary          | Statements, branches, functions, and lines from runner-provided coverage, plus compatible baseline deltas | Only when coverage already exists; absent coverage is unavailable, never 0%; do not enable coverage or install providers automatically                                   |
| Export                    | Versioned JSON and Markdown first; JUnit after a documented mapping                                       | Export only captured data, with truncation notices; JUnit cannot express every runner-specific detail                                                                    |

Reports use retained observations only. Store optional Git revision/dirty-state metadata when available, without claiming that a dirty tree’s contents are fully identified. Cross-branch or changed-environment comparisons must be labeled. New failures in an incomplete run are provisional; resolved failures require comparable completed executions.

### 9. Extensibility and imported results

Keep collection separate from presentation: adapters emit a versioned common model; the dashboard never parses Vitest/Jest terminal formatting. Keep raw native outcome and diagnostic fields available for troubleshooting without making the UI depend on their shape.

After the initial integrations, define a documented adapter contract with compatibility fixtures. A future runner needs to report identity, available lifecycle events, results/errors, capability metadata, and any logs it can safely associate. A minimum adapter can provide file-end results while explicitly lacking individual live-test progress.

A later **Import report** workflow accepts documented JUnit XML and selected runner JSON formats from an explicitly selected workspace file. Imported results are labeled **Imported — completed report** with source and completeness; timestamps, test identity, retry history, or logs absent from the report stay absent. Import does not create live monitoring. Parsing uses bounded input and disables external XML resource resolution.

### 10. Local storage, boundaries, and settings

Store plugin data on the daemon host under a separate proposed `~/.local/state/unit-test-pulse` namespace; install the helper under `~/.local/share/unit-test-pulse`. Allow a documented state-directory override shared by helper and daemon. Data includes captured titles, diagnostic text, logs, project paths, and run metadata. It remains local unless the user explicitly copies or exports it.

Proposed default retention is the latest 100 completed cycles per project and 500 MiB across plugin state. Clean up oldest completed records first and never silently delete active sessions. If active data reaches the budget, pause further log capture with a clear notice while continuing compact results/health records. Settings show retention limits and allow deleting completed history for the current project. Cleanup affects plugin-owned data only.

Logs can contain application secrets. Do not collect full environments or credentials as metadata, and do not claim that stored output is automatically sanitized. Display and export captured text as inert content. Use private state permissions where supported.

The server resolves the selected workspace and checks run ownership before serving details. Source/report reads enforce real-path workspace containment, size limits, and allowed file identities; stack-frame paths alone cannot authorize arbitrary host-file reads. Reject traversal and symlink escapes. Writes use validated identifiers within plugin state. Distinct worktrees and hosts retain separate identities and caches.

### 11. Acceptance criteria and delivery priorities

The first development milestone is a real Vitest run in Paseo with live file/test results, failure stacks and diffs, structured console output where available, raw process output, source previews, and watch-cycle history. This demonstrates the whole workflow before expanding the dashboard.

Initial release readiness requires the same common workflow for Jest, with its log attribution and timing limits stated accurately. Verify at least these scenarios against real supported runner versions:

- A fast pass is visible before a deliberately slow file finishes; totals reconcile after completion.
- Assertion failures, several errors on one test, hook/import/configuration failures, snapshot mismatch, and coverage-related exit failure remain distinguishable.
- Skip/todo-only, no-test, bail, interrupted, crashed-worker, and lost-collector scenarios cannot become a green successful verification.
- Parallel files, concurrent commands, duplicate titles, parameterized tests, runner projects, retries, watch idle, and filtered reruns retain correct identity and counts.
- Test-attributed logs, file-attributed logs, unattributed output, stdout/stderr, silent mode, large logs, and output limits show accurate scope and completeness.
- ESM/CommonJS/TypeScript configurations, custom reporters, transforms/aliases, nested configuration, package-script prerequisites, and existing environments behave equivalently to unmonitored baseline runs within the published matrix. Project file checksums remain unchanged except normal runner-owned outputs/caches.
- Reconnecting clients, plugin reload, and interrupted writes preserve finalized data and surface monitoring gaps. A synthetic 10,000-test run remains browsable without loading all details or logs into one panel response.
- Paseo dark/light themes, failure/source/log dialogs, keyboard and accessible labels, a 320 px panel, and supported client layouts are visually checked.

Advanced reporting, report import, additional adapters, and any run/rerun/stop buttons follow the monitoring release. The initial panel observes executions; invoking a helper still starts tests through the developer or agent’s explicit workflow. Feature availability is published only after its verification gates pass.

## Technical Stack

- **Host** — Paseo client/server plugin, using the same architecture as Cypress Pulse. Its current `>=0.11.2 <0.12.0` host range is a reference candidate, not a verified range for this new plugin. Confirm the app, daemon, and SDK versions during implementation and declare the tested range.
- **Panel** — TypeScript, React, React Native primitives, Paseo theme/UI APIs, and host-provided TanStack Query. Keep platform-specific APIs isolated. These boundaries follow the [Paseo plugin reference](https://paseo.sh/docs/plugins/reference).
- **Contracts** — Shared Zod validation and versioned normalized results/events. Shared modules remain free of client/server runtime dependencies.
- **Collection** — Node.js helper plus separate Vitest/Jest adapters using the monitored project’s installed packages. Prefer Node standard-library collection/storage utilities; add dependencies only for a demonstrated requirement.
- **State** — Local append-only telemetry with producer sequencing and atomically replaced summary snapshots. Final reconciliation uses authoritative runner results; malformed or incomplete records produce notices. The precise transport is selected during the adapter spike to support parallel writers safely.
- **Layout** — `index.client.tsx`, `index.server.ts`, `client/`, `server/`, `shared/`, integration fixtures, and an agent skill. Keep this plugin independently installable; preserve applicable Cypress Pulse licensing notices in reused code.
- **Verification** — Typechecking, meaningful state/adapter tests, isolated real-runner integration fixtures, native-versus-monitored comparisons, and live Paseo panel checks. Pin tooling and publish runner compatibility only after that matrix passes. Implementation versions and the current verification matrix are recorded in README.md; this specification also includes later delivery targets.
