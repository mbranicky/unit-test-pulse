import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exec, npmCommand, packRelease, root } from "./package.mjs";

const temporary = await mkdtemp(
  join(tmpdir(), "unit-test-pulse-package-check-"),
);
const destination = resolve(process.argv[2] || join(root, "work/release"));
try {
  const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(
    await readFile(join(root, "npm-shrinkwrap.json"), "utf8"),
  );
  assert.equal(source.version, lock.version);
  assert.equal(source.version, lock.packages[""].version);
  assert.notEqual(source.private, true);
  const packed = await packRelease(destination),
    archive = join(destination, packed.filename);
  const expected = [
    "paseo-plugin.json",
    "npm-shrinkwrap.json",
    "README.md",
    "OVERVIEW.md",
    "RELEASE_NOTES.md",
    "RELEASING.md",
    "LICENSE",
    "index.client.tsx",
    "index.server.ts",
    "server/jest-reporter.cjs",
    "server/bun-reporter.mjs",
    "server/jasmine-reporter.mjs",
    "skills/unit-test-pulse/SKILL.md",
  ];
  const paths = new Set(packed.files.map((file) => file.path));
  for (const path of expected)
    assert.ok(paths.has(path), `Missing package file: ${path}`);
  assert.ok(
    [...paths].every(
      (path) =>
        !path.startsWith("work/") &&
        !path.startsWith("tests/") &&
        !path.startsWith("examples/") &&
        !path.endsWith(".test.mjs"),
    ),
    "The archive includes development data",
  );
  const extracted = join(temporary, "extracted");
  await mkdir(extracted);
  await exec("tar", ["-xzf", archive, "-C", extracted]);
  const pkg = join(extracted, "package");
  const manifest = JSON.parse(
    await readFile(join(pkg, "paseo-plugin.json"), "utf8"),
  );
  assert.equal(manifest.id, "unit-test-pulse");
  assert.equal(manifest.build, undefined);
  for (const path of manifest.media)
    assert.ok(paths.has(path), `Missing declared media: ${path}`);
  const readme = await readFile(join(pkg, "README.md"), "utf8");
  assert.ok(readme.includes(`npm:paseo-unit-test-pulse@${source.version}`));
  assert.ok(readme.includes(`--ref v${source.version}`));
  assert.ok(
    (await readFile(join(pkg, "OVERVIEW.md"), "utf8")).includes(
      `Version ${source.version}`,
    ),
  );
  assert.ok(
    (await readFile(join(pkg, "RELEASE_NOTES.md"), "utf8")).startsWith(
      `# Release notes\n\n## ${source.version}`,
    ),
  );
  assert.doesNotMatch(readme, /early build|before 1\.0|not yet published/);
  for (const match of readme.matchAll(/(?:src|href)="(assets\/[^"#]+)"/g))
    assert.ok(paths.has(match[1]), `Missing README image: ${match[1]}`);
  // Verify Git's preparation command in isolation, including the published lock.
  const git = join(temporary, "git-install");
  await mkdir(git);
  for (const path of ["package.json", "npm-shrinkwrap.json"])
    await cp(join(root, path), join(git, path));
  const sourceManifest = JSON.parse(
    await readFile(join(root, "paseo-plugin.json"), "utf8"),
  );
  assert.deepEqual(sourceManifest.build, [
    ["npm", "ci", "--omit=dev", "--ignore-scripts"],
  ]);
  await npmCommand(
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: git },
  );
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ name: "pulse-release-check", private: true }),
  );
  await npmCommand(
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { cwd: consumer },
  );
  const installed = join(consumer, "node_modules", source.name),
    require = createRequire(join(installed, "package.json"));
  const installedMetadata = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert.equal(installedMetadata.version, source.version);
  for (const name of Object.keys(source.dependencies)) {
    const metadata = require(`${name}/package.json`);
    assert.equal(
      metadata.version,
      lock.packages[`node_modules/${name}`].version,
    );
  }
  for (const name of [
    "vitest",
    "jest",
    "mocha",
    "bun",
    "jasmine",
    "@getpaseo/plugin",
  ])
    assert.throws(
      () => require.resolve(`${name}/package.json`),
      `Development dependency installed: ${name}`,
    );
  const bin = join(consumer, "node_modules/.bin/unit-test-pulse");
  const help = await exec(process.execPath, [bin, "--help"], {
    timeout: 10000,
  });
  assert.match(help.stdout, /Unit Test Pulse/);
  const { readTestSource } = await import(
    pathToFileURL(join(installed, "server/test-source.mjs")).href
  );
  const state = join(temporary, "state");
  const results = [];
  for (const runner of ["vitest", "jest", "mocha", "bun", "jasmine", "node"]) {
    const project = join(root, "examples", runner),
      args = [
        join(installed, "server/cli.mjs"),
        "run",
        "--project",
        project,
        "--workspace",
        root,
        "--state-dir",
        state,
        "--runner",
        runner,
        "--",
        ...(runner === "jest" ? ["--runInBand"] : []),
      ];
    const options = {
      cwd: root,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        UNIT_TEST_PULSE_BUN_BIN: join(root, "node_modules/.bin/bun"),
      },
    };
    let result;
    try {
      result = await exec(process.execPath, args, options);
    } catch (error) {
      result = error;
    }
    assert.equal(
      result.code,
      runner === "jasmine" ? 3 : 1,
      `${runner}: ${result.message || ""}\n${result.stdout}\n${result.stderr}`,
    );
    const id = /\[Unit Test Pulse\] Run ([a-f0-9]{32})/.exec(
      result.stderr,
    )?.[1];
    assert.ok(id, runner);
    const run = JSON.parse(
      await readFile(join(state, "runs", id, "summary.json"), "utf8"),
    );
    assert.equal(run.total, 10);
    assert.equal(run.failed, 1);
    assert.equal(run.totalComplete, true);
    assert.equal(run.files.length, 2);
    assert.equal(
      run.flaky,
      ["vitest", "jest", "mocha", "bun"].includes(runner) ? 1 : 0,
    );
    const failed = run.tests.find((test) => test.status === "failed");
    const sourcePreview = await readTestSource(run, failed.id, root);
    assert.match(sourcePreview.text, /welcome discount/);
    const extension = ["vitest", "bun"].includes(runner)
      ? "ts"
      : runner === "node"
        ? "mjs"
        : "cjs";
    const cleanArgs = [
      ...args,
      ...(runner === "mocha" ? ["--no-config"] : []),
      `pricing.test.${extension}`,
    ];
    const cleanResult = await exec(process.execPath, cleanArgs, options);
    const cleanId = /\[Unit Test Pulse\] Run ([a-f0-9]{32})/.exec(
      cleanResult.stderr,
    )?.[1];
    assert.ok(cleanId, `${runner}: no clean-run identity`);
    const clean = JSON.parse(
      await readFile(join(state, "runs", cleanId, "summary.json"), "utf8"),
    );
    assert.equal(clean.status, "passed", runner);
    assert.equal(clean.passed, 4);
    assert.equal(clean.total, 4);
    assert.equal(clean.totalComplete, true);
    results.push({
      runner,
      total: run.total,
      failed: run.failed,
      flaky: run.flaky,
      sourcePreview: true,
      cleanRunPassed: true,
    });
  }
  const bytes = await readFile(archive),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const report = {
    package: source.name,
    version: source.version,
    archive,
    sha256,
    integrity: packed.integrity,
    files: packed.files.length,
    productionInstall: true,
    gitPreparation: true,
    runners: results,
  };
  await writeFile(
    join(destination, "verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
