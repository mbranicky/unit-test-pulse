# Release notes

## 1.0.2

- Restore installation on Paseo 0.14 with a verified `>=0.11.2 <0.15.0` compatibility range. Retain the locked 0.12.0 development SDK, minimum 0.11.2 checks and previous 0.13 SDK checks; add exact 0.14.0 SDK verification to CI.
- Verify isolated 0.14.0 daemon activation, live results, failure diagnostics, source previews, logs, search, persistent history, skill links and reload during execution. Verify panel rendering and command registration in the installed 0.14.0 macOS app.
- Collapse healthy queued, running and completed test files by default. Expand files when failures or file errors arrive, collapse on recovery, and preserve manual toggles between failure transitions. Add 13 React component regression cases, including large-suite pages with unloaded test details.

## 1.0.1

- Restore installation on Paseo 0.13 with a verified `>=0.11.2 <0.14.0` compatibility range. Preserve the locked 0.12.0 development SDK and 0.11.2 minimum checks; add exact 0.13.1 and 0.13.2 SDK checks to CI.
- Verify isolated 0.13.1/0.13.2 daemon activation, reload during execution, live results, diagnostics, source, logs, search, history and skill links; verify the populated panel in the installed Paseo 0.13.1 macOS app.
- Add manual GitHub Actions publication from the exact tested GitHub Release archive, with npm trusted publishing and verification gates.

- Clarify the local helper copy and launcher locations in the plugin listing overview.
- Document all three agent skill-link folders and the protection of existing files owned by other installations, following registry review feedback.

Runner integrations and runtime behavior are unchanged.

## 1.0.0

First stable release of Unit Test Pulse for Paseo.

- Monitor Vitest 4/5, Jest 30, Mocha 11/12, Bun 1.4.x from 1.4.3, Jasmine 6/7, and Node.js 22.18+/24 built-in tests through a shared file/test dashboard.
- Inspect live progress, assertion failures, available expected/actual values and stack traces, current per-test source declarations, full-file previews, and captured logs. Copy run/test reports and paged output for debugging.
- Keep independent commands and native watch cycles separate, with idle states, history, status filters, search, and a workspace header indicator. Jasmine uses one-shot runs.
- Preserve runner configuration, loaders, preloads, existing reporters and native exit behavior. Supported retries distinguish flaky passes; pending, skipped, todo, cancellation and incomplete collection remain explicit.
- Fix Jest clean-run status by waiting for finalized aggregate success, including coverage, snapshots and custom-reporter failures. Keep retry results under their original identities; defer ambiguous generated-name retry updates until the final file report.
- Fix CLI entry detection through npm executable symlinks and canonical temporary paths so installed commands actually run.
- Omit removed worktrees and files disappearing during history cleanup without repeated read warnings. Unexpected errors and damaged records still produce notices.
- Include native and monitored demo projects for all six adapters, with passing pricing suites and intentional cart failures. CI covers both supported Node lines, unit/integration tests, and the production package.
- Prepare npm identity `paseo-unit-test-pulse`, a published dependency shrinkwrap, a source manifest with locked Git preparation, production archive verification, installation guidance, and an optional agent skill.

Paseo app and daemon compatibility: `>=0.11.2 <0.13.0`. Desktop behavior has been checked on macOS; Ubuntu CI checks the helper. Windows, Linux desktop and native mobile clients, browser test mode, and complex multi-project configurations require further verification.

Console ownership follows runner-provided identities. Vitest can attribute records to tests; Jest and Node can provide file-scoped records. Mocha and Bun process output remains run-scoped. Jasmine provides test-owned debug logs for failing specs and pending reasons. Bun lifecycle errors have no test identity, and some assertion errors carry no stack frames. Bun parallel workers, hot reload and competing inspector sessions are unavailable in this adapter.

Capture and retention policies remain fixed. Advanced historical comparisons, configurable retention, report imports, failure grouping and coverage dashboards are outside this release. See README for precise capture limits and adapter restrictions. Stored text can include secrets; an agent reading it can send it to its configured provider.
