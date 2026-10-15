# Unit Test Pulse — Implementation Plan

Prepared 15 October 2026. This is a proposed delivery plan for [the product specification](spec.md), not an implementation status report. The first working implementation now exists in this folder. The milestone exit conditions remain the full delivery criteria; the current compatibility evidence and remaining limits are recorded in README.md.

## Current implementation status

- Implemented: independent plugin and helper, common results, Vitest 4/5 and Jest 30 adapters, batch/watch cycles, local history, live file groups, filters/search, diagnostics, logs, source previews, and opt-in agent skill setup.
- Verified: see the exact runner versions and local/integration checks in README.md. The first build is intentionally narrower than the complete compatibility matrix below.
- Remaining: broader platform and multi-project verification, configuration-reload behavior, configurable retention and a hard active-data budget, advanced comparisons/reporting, and additional adapters/imports.

## 1. Prove the integration boundaries

Use small isolated projects to exercise the installed Vitest and Jest versions. Check released-version reporter APIs rather than assuming their current development branches describe every supported release.

- Demonstrate reporter composition without changing project files or dropping existing reporters/options.
- Check ESM, CommonJS, TypeScript, nested configuration, existing transforms/environments, and multi-project invocation.
- Demonstrate individual test events, file-end reconciliation, retry evidence, watch-cycle boundaries, and errors before any tests exist.
- Establish exactly when console output arrives and which test/file identity it includes; retain process output as the baseline fallback.
- Compare native and monitored invocation, including exit codes, configured coverage thresholds, package-script prerequisites, reporter outputs, and project checksums.

**Exit condition:** record a tested compatibility/capability matrix, select pinned development fixtures, and choose a launch approach per runner. Do not promise custom-environment replacement or uninstrumented-process attachment.

## 2. Establish the independent plugin and common model

Create the Paseo project with display name **Unit Test Pulse** and ID `unit-test-pulse`. The user selected `/Users/marek/Projects/paseo/unit-test-pulse` for implementation. Confirm host/SDK compatibility before copying manifest ranges.

Separate session, cycle, runner project, file, suite, test, attempt, error, log, and collector-health identities. Define authoritative final reconciliation and idempotent event handling before adding UI. Keep verification outcome separate from process/session lifecycle and capture completeness.

Select a local event transport that handles parallel producers without interleaved records, bounds output, and survives partial writes. Keep the state/helper namespace independent from Cypress Pulse.

**Exit condition:** meaningful reducer/store tests cover duplicate/reordered events, late watch-cycle output, provisional totals, retries, interruption, empty runs, and non-test failures. Reloading data produces the same final summary.

## 3. Deliver the Vitest workflow end to end

Connect an actual Vitest reporter and helper to the panel. Start with batch execution, then add watch sessions using the same model. Bring over the familiar toolbar, summary, file cards, source preview, failure/stack dialogs, and header activity indicator.

Add run/file/test log views, explicit attribution, capture notices, search, pagination, and copy actions. Verify partial results while a slow test is still running. Add the opt-in agent skill installer and structured helper reads once actual invocation behavior is known.

**Exit condition:** a real Vitest fixture can be monitored in Paseo, including failure diagnostics, output, watch idle/rerun, and interrupted execution. Inspect dark/light and narrow layouts in the app. Describe this milestone as Vitest-only until Jest passes its own gate.

## 4. Add Jest and validate the common design

Implement Jest through the same adapter boundary. Use actual supported test/file events and final results; preserve custom reporter and environment behavior. Show file console buffers when supplied and retain raw stdout/stderr. Identify unavailable live/per-test console attribution explicitly.

Verify multi-project identity, duplicate titles, watch subsets, concurrent execution, retry evidence, hooks/import failures, and no-tests/skip/todo behavior. If Jest requires substantial runner-specific UI logic, revisit the common model before duplicating the dashboard.

**Exit condition:** Vitest and Jest both pass the documented compatibility matrix and the release acceptance scenarios. No runner feature is labeled supported solely because its unit-test fixture passes.

## 5. Complete the monitoring release

Verify large-suite browsing and bounded logs/state, path ownership and source-read boundaries, client reconnection, plugin reload, cleanup, and readable export/copy output. Complete installation, troubleshooting, doctor, capability, and known-limit documentation. Add actual screenshots only after observing the implemented panel.

The first release includes current-run summaries, durations/slowest items, local history, copyable Markdown reports, and versioned agent JSON reads. Its UI follows Cypress Pulse without carrying Cypress/browser/media assumptions.

**Exit condition:** all initial-release criteria in the specification pass with evidence, and advertised versions match the tested app/daemon/runner matrix. Install/publish actions belong to the implementation delivery workflow, not this preparation stage.

## 6. Extend reporting and runner coverage

Build comparisons, duration history, retry/outcome variability, failure grouping, existing-coverage summaries, and exports in that order. Add explicit report import and further adapters after documenting the common contract and attribution requirements. Keep subset and environment comparability visible in every historical metric.

**Exit condition:** each report has real-data checks for insufficient samples, mismatched selection, incomplete runs, changed revisions, absent coverage, and missing identity. An additional runner can integrate without changes to the core result UI.

## Cypress Pulse reuse assessment

Reference root: `/Users/marek/Projects/paseo/cypress-pulse`.

| Existing area                                                       | Proposed treatment                                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `index.client.tsx`, `client/panel.tsx`                              | Reuse registration and layout patterns; rename identity, queries, labels, and actions                                         |
| `client/ui.tsx`, summary/header components                          | Adapt theme, spacing, status indicators, and narrow-panel behavior to the new state model                                     |
| `client/spec-group.tsx`, `client/test-row.tsx`                      | Adapt file grouping and failures; add runner-project identity, todo/cancelled outcomes, attempts, diffs, and log entry points |
| `client/detail-modal.tsx`, `client/source-preview.tsx`              | Evaluate reuse for source, failure, and log dialogs with corresponding server-side boundaries                                 |
| `shared/rpc.ts`, progress/file helpers                              | Use patterns; replace Cypress-shaped schemas and count/status assumptions                                                     |
| `server/store.mjs`, runtime/helper installation, source handlers    | Review and adapt ownership, atomic state, helper installation, and safe reads; validate with the new lifecycle                |
| Skill installer and agent setup                                     | Reuse ownership protection; introduce separate links and runner-specific guidance                                             |
| Cypress configuration wrapper, reporter, telemetry, tap integration | Replace with actual runner adapters; do not port Cypress lifecycle assumptions                                                |
| Screenshot/video/media modules and capture preferences              | Omit; replace relevant settings with diagnostic capture and retention controls                                                |
| Existing tests and assets                                           | Use as behavioral/design references; write relevant new fixtures and capture the actual Unit Test Pulse UI                    |

The reference project remains unchanged. Reused code must retain required license attribution. Shared packaging between the two plugins can be considered after both models stabilize; it is not a prerequisite for the first integration.
