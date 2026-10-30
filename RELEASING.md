# Release procedure

Prepare and verify the final source, documentation and exact package before creating a release tag or publishing. A version change, push, tag, GitHub release, npm publication and registry submission require their corresponding maintainer authorization. Preparation does not publish the package. Work on `main` unless the maintainer explicitly requests a branch.

## Finalize the candidate

1. Update the version in `package.json` and both root version fields in `npm-shrinkwrap.json`, plus README, OVERVIEW, release notes, example/skill instructions and any version-specific installation references. Use minor versions for new features and patch versions for bug fixes. Keep npm name `paseo-unit-test-pulse` and plugin ID/helper/skill `unit-test-pulse`.
2. Preserve the supported Node/Paseo ranges unless new verification supports changing them. Distinguish macOS desktop checks from Ubuntu helper CI, and document other unverified platforms and runner modes accurately.
3. Install and check the source checkout:

   ```sh
   npm ci --ignore-scripts
   npm run setup:compat
   npm run check
   npm run typecheck:paseo-011
   npm run typecheck:paseo-013
   npm run typecheck:paseo-014
   python3 -m unittest discover -s scripts -p 'test_npm_release.py'
   npm run test:integration
   npm run test:package
   npm audit --omit=dev
   ```

   Run the unit/integration/package checks under Node 22.18.0 and 24.x. The compatibility setup prepares the pinned Bun executable and Vitest 4 fixture. Preserve native environments, reporters, exit behavior and per-record log ownership in adapter regressions. Review development advisories as well as production findings; do not force dependency upgrades that conflict with Paseo's host API.

4. `npm run test:package` writes `work/release/paseo-unit-test-pulse-1.0.2.tgz` and `verification.json` for this version. It checks the package/docs/assets and shrinkwrap, exercises locked Git preparation and a production-only npm installation, and runs all six adapter demos using that installed helper. Each full demo intentionally exits unsuccessfully; its captured results, source previews and expected exit are verified. The passing pricing files provide clean-run checks.
5. Typecheck, reload the plugin and require `running` with no initialization errors. Exercise the installed helper, reports, source reads, output and skill behavior. Use representative live, failed, clean, skipped and watch runs. Inspect UI changes in the intended desktop theme and compact layout. Preserve existing user data and settings. Do not restart the daemon for plugin changes.
6. Inspect the actual tarball and production dependency audit. Confirm no test fixtures, ignored work, secrets or development packages are distributed. Check the npm README's installation commands and images, required overview, release notes and exact version. The `npm-shrinkwrap.json` is the canonical root lock, consumed by both development and production installs. Regenerate it deliberately when dependencies change.

## Package and source installation

`npm run pack:release` builds the npm candidate under `work/release/`; `npm run test:package` builds and verifies that same form. The source manifest declares `npm ci --omit=dev --ignore-scripts` for Git preparation. The staged npm manifest omits that command because npm already installs production dependencies from the published shrinkwrap. Publish the verified staged archive, rather than invoking publication on the source checkout.

The package test and build tools require the source checkout and its development dependencies. Example projects are repository demonstrations, not production package contents. The README links to the versioned source examples.

## Finish delivery

After review, commit and push the complete candidate only when authorized. Require both GitHub Node jobs to pass on the final `main` revision, including unit, integration and package checks. Rebuild/reverify after any packaged-file change. Record the artifact's SHA-256 and npm integrity. Confirm repository visibility and the npm publishing account before a public release; changing repository visibility is a separate maintainer action.

For a 1.0.2 release, after maintainer authorization, use tag `v1.0.2` at the verified commit and publish the exact checked archive. Tagging, GitHub release creation, npm publication and registry submission happen after all final checks. Do not move an existing tag or overwrite a published release. Corrections after publication need a new version.

After publication, verify registry metadata, download and compare the published archive with the checked artifact, and install `npm:paseo-unit-test-pulse@1.0.2` into a test Paseo daemon. Require `running`, then verify helper collection, source previews, reports, logs, skill installation and reload. A missing version during registry propagation is not authorization to publish again.

Registry listing and public npm availability are separate outcomes. Use the actual published npm version or source commit in any authorized registry submission; do not claim catalog availability until it is verified.

## Manual npm publication through GitHub Actions

The `Publish to npm` workflow (`.github/workflows/publish.yml`) accepts a stable version and `dry-run` (default), `publish`, or `verify` mode. Run it from `main` after that version's published GitHub Release contains the exact verified archive and `SHA256SUMS`. GitHub supplies the source ZIP and tar.gz. The workflow requires the tagged commit to be merged into main and both `check (22.18.0)` and `check (24)` jobs to pass in its latest main Check build. It compares the downloaded archive with the tagged source, allowing only removal of the Git-only manifest build command, and never executes release lifecycle scripts. Publication requires npm 11.5.1 or newer; CI isolates npm 11.13.0 for publication verifier tests on both Node lines.

One-time configuration for the npm package `paseo-unit-test-pulse`: add a GitHub Actions trusted publisher with owner `mbranicky`, repository `unit-test-pulse`, workflow filename `publish.yml`, and environment `npm`. Enable **Allow npm publish** for this direct-publication workflow. Keep account 2FA enabled; no npm token or local npm login is needed. Configure the GitHub `npm` environment to allow deployments only from `main`.

After authorization, run `dry-run`, inspect the result, then run `publish` once. A dry run does not prove OIDC credentials are accepted. The workflow rejects existing npm versions and moving `latest` backwards. It verifies registry integrity, the distribution tag and downloaded bytes after publishing. If npm accepts publication but registry processing is delayed, resume with `verify`; never repeat an accepted publish. Inspect `_npmUser.trustedPublisher` to establish the authentication method. Finally verify a fresh npm installation in an isolated Paseo daemon and preserve the user's active installation.
