# Unit Test Pulse

Unit Test Pulse follows JavaScript and TypeScript unit tests beside your Paseo agents. The workspace panel shows live results grouped by file, failure messages, stack traces, assertion details, current source previews, and captured logs. A header indicator keeps execution visible when the panel is closed.

The initial build integrates with Vitest 4/5 and Jest 30 through a local helper using the tested project's installed runner. The panel's optional agent skill explains how to launch monitored tests while retaining the project's normal environment and prerequisites. Existing uninstrumented commands cannot be attached after launch.

Each watch cycle is a separate result, with an idle state between cycles. Concurrent commands retain independent identities. Filters and search narrow the displayed tests while run counts remain complete for the captured execution. Failure reports and paged output can be copied for debugging.

Vitest console records can carry test identity. Jest console buffers are file-scoped when supplied, while process stdout/stderr stays associated with the run. Runner settings can suppress output. Capture limits and unavailable details are shown explicitly.

This early build was checked with Paseo 0.11.2 on macOS, Node 22.18.0/24.16.0, Vitest 4.1.11/5.0.4, and Jest 30.5.2. Other platforms, browser-mode tests, and complex multi-project configurations need further verification.

Results and logs remain on the daemon host under `~/.local/state/unit-test-pulse` unless copied. Logs can contain application secrets. History and capture policies are currently fixed; advanced reporting and additional runner adapters are planned.
