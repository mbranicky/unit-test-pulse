import {
  lstat,
  mkdir,
  readFile,
  readlink,
  symlink,
  unlink,
  writeFile,
  rename,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const name = "unit-test-pulse";
export function skillPaths(home = homedir()) {
  return [".agents", ".claude", ".codex"].map((folder) =>
    join(home, folder, "skills", name),
  );
}
const registryPath = (home) =>
  join(home, ".local", "share", name, "skill-links.json");
async function registry(home) {
  try {
    return JSON.parse(await readFile(registryPath(home), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
/** @returns {Promise<"missing" | "current" | "outdated" | "foreign">} */
async function linkState(path, source, owned) {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
  if (!stat.isSymbolicLink()) return "foreign";
  const target = resolve(dirname(path), await readlink(path));
  if (target === source) return "current";
  // Only links recorded by this installer can be updated. A similar name is not ownership.
  return owned[path] === target ? "outdated" : "foreign";
}
export async function skillStatus(pluginDirectory, home = homedir()) {
  const source = join(pluginDirectory, "skills", name);
  await readFile(join(source, "SKILL.md"), "utf8");
  const owned = await registry(home);
  const targets = await Promise.all(
    skillPaths(home).map(async (path) => ({
      path,
      state: await linkState(path, source, owned),
    })),
  );
  const states = targets.map((target) => target.state);
  /** @type {"missing" | "current" | "outdated" | "foreign"} */
  const state = states.includes("outdated")
    ? "outdated"
    : states.includes("missing")
      ? "missing"
      : states.includes("current")
        ? "current"
        : "foreign";
  return { state, targets };
}
// Several workspace panels can request installation on the same host at once.
const installations = new Map();
export function installSkill(pluginDirectory, home = homedir()) {
  const previous = installations.get(home) || Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(() => performInstall(pluginDirectory, home));
  installations.set(home, pending);
  return pending.finally(() => {
    if (installations.get(home) === pending) installations.delete(home);
  });
}
async function performInstall(pluginDirectory, home) {
  const source = join(pluginDirectory, "skills", name);
  const status = await skillStatus(pluginDirectory, home);
  if (status.state === "foreign")
    throw new Error(
      "Existing Unit Test Pulse skills are not managed by this plugin. They have been left unchanged.",
    );
  const owned = await registry(home);
  const file = registryPath(home);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  for (const { path } of status.targets) {
    const state = await linkState(path, source, owned);
    if (state === "foreign") continue;
    if (state === "outdated") await unlink(path);
    if (state !== "current") {
      await mkdir(dirname(path), { recursive: true });
      try {
        await symlink(source, path, "dir");
      } catch (error) {
        if (error.code === "EEXIST") continue;
        throw error;
      }
    }
    owned[path] = source;
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(owned), { mode: 0o600 });
    await rename(temporary, file);
  }
  return skillStatus(pluginDirectory, home);
}
