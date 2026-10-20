# 1.0.0 release verification

Historical verification record for the 1.0.0 artifact. The preparation and remaining-step wording below records that candidate at the time of verification; it does not describe the status or checks of later releases.

Local verification completed on 2026-10-20, before delivery, against the candidate based on `main` at `2a2ad86`. The maintainer subsequently authorized commit and push to `main`. Tagging and publication remain separate delivery steps. This verification record is repository documentation and is excluded from the npm artifact.

## Candidate

- Package: `paseo-unit-test-pulse@1.0.0`, public npm metadata prepared.
- Plugin ID, helper and optional skill: `unit-test-pulse`.
- Canonical root lock: `npm-shrinkwrap.json`, replacing the repository-only package lock.
- npm archive: `work/release/paseo-unit-test-pulse-1.0.0.tgz`.
- SHA-256: `d8c1e28ba71354f16758a421aae57acf3b25301ff3cf2139d7bfef60231181b0`.
- npm integrity: `sha512-6ip2oC4YRf6EHcrG2k8tmr9XhN4aChfgSDVgym4xmO6bQH88GuA92VFITsXvoQLrI3OHHZQmS3exbgx2uW9sXw==`.
- Packaged files: 58; required entries, overview, README, release notes/procedure, local modules, skill, declared screenshots and dependency lock are present. Source tests, examples, work data and development tools are excluded.

## Verification results

| Check                   | Result                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 22.18.0            | Typecheck, 35 unit tests and 133 real-runner integration tests passed                                                                                     |
| Node 24.16.0            | Typecheck, 35 unit tests and 133 real-runner integration tests passed                                                                                     |
| Paseo SDK               | Client/server/shared code typechecks against 0.11.2 and 0.12.0                                                                                            |
| Production artifact     | Fresh production-only npm installation passed on both Node versions                                                                                       |
| Installed adapters      | All six intentional-failure demos preserve expected counts/exits and source previews; all six pricing suites report four passes and exit 0                |
| Git preparation         | Locked production dependency installation passed in an isolated directory                                                                                 |
| npm executable          | Installed executable symlink invokes help; regression covers canonical/symlink CLI entry detection                                                        |
| Reproducibility         | Node 22 and 24 produced identical SHA-256 and npm integrity                                                                                               |
| Paseo runtime           | Existing enabled `unit-test-pulse` reloaded and reports `running`, with no initialization error                                                           |
| Installed helper        | Clean Jest pricing run reports passed with four tests; Bun demo records ten tests, one failure and one flaky pass through the copied WebSocket dependency |
| Production audit        | Zero vulnerabilities with `npm audit --omit=dev`                                                                                                          |
| Formatting and metadata | Formatting, YAML, manifest media, root versions and whitespace checks passed                                                                              |

Release regressions cover finalized Jest status, immediate/deferred retries with and without source locations, generated duplicate names, parallel workers, watch pass/fail/recovery, coverage and obsolete snapshots, custom reporter failure with a zero native failure exit, and npm-style CLI symlinks. The existing six-adapter regression suite also passes.

The installed-package checks use the exact staged archive, whose npm manifest omits Git-only dependency preparation. The source manifest retains its locked preparation command. The Node 22 report is under `work/release/node22/verification.json`; the primary report is under `work/release/verification.json`.

## Dependency assessment

The full development tree reports 35 advisories: 1 low, 18 moderate and 16 high. They are confined to development/compatibility tooling, including React Native/Jest/Metro dependency paths and the pinned Mocha compatibility fixture. Advisory leaves include braces, serialize-javascript, sprintf-js and diff. The tested production-only installation excludes those tools and its production audit is clean.

These development findings remain open. The suggested aggregate fixes include a React Native 0.88 major upgrade and an incompatible Jest major change; those are not applied to Paseo 0.12 host tooling or to runner-version compatibility fixtures. Development fixtures execute controlled repository examples. Reassess the findings when upgrading the SDK and runner fixtures; do not interpret the clean production audit as a clean development audit.

## Remaining delivery steps

- Require both updated GitHub jobs to pass on the final delivered revision before tagging or publication. The local verification results above do not establish GitHub CI status; check the workflow attached to that revision.
- The GitHub repository is currently **private**, verified during preparation. A public source/registry release needs a separate visibility decision; no repository settings were changed.
- Create `v1.0.0`, a GitHub release, npm publication and registry submission only after corresponding maintainer authorization and final checks. No existing tags were moved.
- Verify the exact published npm archive and a fresh npm-based Paseo installation after publication. Current checks verify the local production archive and running source plugin; they do not claim npm or catalog availability.

Desktop checks are on macOS/Paseo 0.12.0. SDK compatibility with 0.11.2 does not claim a fresh desktop run on that version. Ubuntu helper coverage for the final revision must be confirmed by the updated release workflow after push. Windows, Linux desktop, native mobile clients, browser mode and complex multi-project setups remain unverified as described in README.
