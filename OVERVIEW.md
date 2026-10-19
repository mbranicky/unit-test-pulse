# Unit Test Pulse

Unit Test Pulse follows JavaScript and TypeScript unit tests beside your Paseo agents. The workspace panel shows live results grouped by file, failure messages, stack traces, assertion details, current source previews, and captured logs. A header indicator keeps execution visible when the panel is closed.

Version 0.3.0 integrates with Vitest 4/5, Jest 30, and Node.js 22.18+/24 built-in tests through a local helper. Vitest/Jest use the tested project's installed runner; Node tests use the helper's Node executable without installing a framework. The panel's optional agent skill explains how to launch monitored tests while retaining the project's normal environment and prerequisites. Existing uninstrumented commands cannot be attached after launch.

Each watch cycle is a separate result, with an idle state between cycles. Concurrent commands retain independent identities. Filters and search narrow the displayed tests while run counts remain complete for the captured execution. Failure reports and paged output can be copied for debugging.

Node tests retain original assertion stacks and expected/actual values, with source previews for `test()`, `it()`, and context subtests. Existing native reporters, loader settings, and test selection are preserved. Node watch cycles contain only files re-executed by the runner.

Vitest console records can carry test identity. Jest console buffers are file-scoped when supplied, and Node.js output records are file-scoped, while process stdout/stderr stays associated with the run. Runner settings can suppress output. Capture limits and unavailable details are shown explicitly.

This early build was checked with Paseo 0.11.2 on macOS, Node 22.18.0/24.16.0, Vitest 4.1.11/5.0.4, and Jest 30.5.2. Other platforms, browser-mode tests, and complex multi-project configurations need further verification.

Results and logs remain on the daemon host under `~/.local/state/unit-test-pulse` unless copied. Logs can contain application secrets. History and capture policies are currently fixed; advanced reporting and adapters for other independent runners are planned.
