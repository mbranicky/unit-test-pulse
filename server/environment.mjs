import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
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
  return ["vitest", "jest"].flatMap((runner) => {
    try {
      const file = require.resolve(`${runner}/package.json`);
      const { version } = JSON.parse(readFileSync(file, "utf8"));
      const supported =
        runner === "vitest" ? /^[45]\./.test(version) : /^30\./.test(version);
      return [{ runner, version, packageFile: file, supported }];
    } catch {
      return [];
    }
  });
}
