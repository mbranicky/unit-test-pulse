import { homedir } from "node:os";
import { join, relative, isAbsolute, dirname } from "node:path";
import { createRequire } from "node:module";
import { readFileSync, realpathSync, accessSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
export const stateRoot = () =>
  process.env.UNIT_TEST_PULSE_STATE_DIR ||
  join(homedir(), ".local", "state", "unit-test-pulse");
export function inside(root, file) {
  const p = relative(root, file);
  return (
    p === "" ||
    (!p.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      p !== ".." &&
      !isAbsolute(p))
  );
}
export function discover(root) {
  const require = createRequire(join(realpathSync(root), "package.json"));
  const packages = ["vitest", "jest", "mocha", "jasmine"].flatMap((runner) => {
    try {
      const file =
        runner === "jasmine"
          ? join(dirname(require.resolve("jasmine")), "../package.json")
          : require.resolve(`${runner}/package.json`);
      const { version } = JSON.parse(readFileSync(file, "utf8"));
      const supported =
        runner === "vitest"
          ? /^[45]\./.test(version)
          : runner === "mocha"
            ? /^(11|12)\./.test(version)
            : runner === "jasmine"
              ? /^[67]\./.test(version)
              : /^30\./.test(version);
      return [{ runner, version, packageFile: file, supported }];
    } catch {
      return [];
    }
  });
  return [
    ...packages,
    ...discoverBun(root),
    {
      runner: "node",
      version: process.versions.node,
      executable: process.execPath,
      supported:
        Number(process.versions.node.split(".")[0]) === 24 ||
        (Number(process.versions.node.split(".")[0]) === 22 &&
          Number(process.versions.node.split(".")[1]) >= 18),
    },
  ];
}

export function discoverBun(root) {
  const candidates = process.env.UNIT_TEST_PULSE_BUN_BIN
    ? [resolve(process.env.UNIT_TEST_PULSE_BUN_BIN)]
    : [
        join(
          root,
          "node_modules",
          ".bin",
          process.platform === "win32" ? "bun.exe" : "bun",
        ),
        ...(process.env.PATH || "")
          .split(delimiter)
          .filter(Boolean)
          .map((directory) =>
            join(directory, process.platform === "win32" ? "bun.exe" : "bun"),
          ),
      ];
  for (const executable of candidates) {
    try {
      accessSync(executable, constants.X_OK);
    } catch {
      continue;
    }
    const result = spawnSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      cwd: root,
    });
    const version = result.stdout?.trim();
    if (result.status === 0 && /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version))
      return [
        {
          runner: "bun",
          version,
          executable,
          supported:
            /^1\.4\./.test(version) && Number(version.split(".")[2]) >= 3,
        },
      ];
  }
  return [];
}
