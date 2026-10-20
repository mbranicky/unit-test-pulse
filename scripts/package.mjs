import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const exec = promisify(execFile);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
export const npmCommand = (args, options = {}) =>
  exec(npm, args, { cwd: root, maxBuffer: 8 * 1024 * 1024, ...options });

export async function packRelease(destination) {
  await mkdir(destination, { recursive: true });
  const staging = await mkdtemp(join(tmpdir(), "unit-test-pulse-pack-"));
  try {
    const { stdout } = await npmCommand([
      "pack",
      "--dry-run",
      "--ignore-scripts",
      "--json",
    ]);
    const [listing] = JSON.parse(stdout);
    for (const { path } of listing.files) {
      await mkdir(dirname(join(staging, path)), { recursive: true });
      await cp(join(root, path), join(staging, path));
    }
    // npm already installs the locked production dependencies. Git sources
    // retain their preparation command; the npm manifest omits that extra work.
    const file = join(staging, "paseo-plugin.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    delete manifest.build;
    await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
    const packed = await npmCommand(
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        resolve(destination),
      ],
      { cwd: staging },
    );
    return JSON.parse(packed.stdout)[0];
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(
      await packRelease(resolve(process.argv[2] || join(root, "work/release"))),
      null,
      2,
    ),
  );
}
