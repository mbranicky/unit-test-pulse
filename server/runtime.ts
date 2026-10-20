import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const marker = "// Managed by the unit-test-pulse Paseo plugin.\n";
const files = [
  "cli.mjs",
  "environment.mjs",
  "store.mjs",
  "model.mjs",
  "worker.mjs",
  "vitest-reporter.mjs",
  "vitest-progress.mjs",
  "vitest-progress-loader.mjs",
  "jest-reporter.cjs",
  "node-runner.mjs",
  "node-reporter.mjs",
  "mocha-runner.mjs",
  "mocha-bridge.mjs",
  "mocha-reporter.mjs",
  "channel.cjs",
];
export async function findPluginDirectory(): Promise<string> {
  let source: string | undefined;
  for (const cli of [
    process.env.PASEO_BIN,
    "paseo",
    "/Applications/Paseo.app/Contents/Resources/bin/paseo",
  ].filter(Boolean) as string[]) {
    try {
      const { stdout } = await promisify(execFile)(
        cli,
        ["plugin", "ls", "unit-test-pulse", "--json"],
        { timeout: 5000 },
      );
      source = (
        JSON.parse(stdout) as Array<{ id: string; path?: string }>
      ).find((entry) => entry.id === "unit-test-pulse")?.path;
      if (source) break;
    } catch {
      /* Try the configured CLI and then PATH. */
    }
  }
  if (!source)
    throw new Error("Could not locate the installed Unit Test Pulse helper.");
  return source;
}
export async function installHelper(): Promise<string> {
  const source = await findPluginDirectory();
  const contents = await Promise.all(
    files.map((file) => readFile(join(source!, "server", file), "utf8")),
  );
  const hash = createHash("sha256")
    .update(contents.join("\0"))
    .digest("hex")
    .slice(0, 16);
  const folder = join(homedir(), ".local", "share", "unit-test-pulse");
  const version = join(folder, "runtime", hash);
  await mkdir(version, { recursive: true, mode: 0o700 });
  for (const [index, file] of files.entries())
    await writeFile(join(version, file), contents[index], { mode: 0o600 });
  const helper = join(folder, "cli.mjs");
  const existing = await readFile(helper, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  });
  if (existing !== null && !existing.startsWith(marker))
    throw new Error(
      "The helper location contains a file Unit Test Pulse does not own.",
    );
  const temporary = `${helper}.${process.pid}.tmp`;
  const script = `${marker}import { main } from ${JSON.stringify(pathToFileURL(join(version, "cli.mjs")).href)};\nmain().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });\n`;
  await writeFile(temporary, script, { mode: 0o600 });
  await rename(temporary, helper);
  return helper;
}
