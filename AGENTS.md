# Project instructions

- Implement every new feature and bug fix on a feature branch created from the latest `origin/main`. Fetch origin before creating the branch; do not implement directly on `main`.

- Keep runner integrations separate from the shared result model and panel.
- Never infer per-test log ownership from interleaved process output.
- Preserve monitored project configuration, existing reporters, and exit behavior.
- Change the plugin version only when the user explicitly requests a version change.
- Use minor version increments for features; reserve patch version increments for bug fixes.
- Run `npm run check` and real runner integration tests before delivery.
