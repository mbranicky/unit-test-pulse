import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { root, exec, npmCommand } from "./package.mjs";
const version = "0.11.2";
await mkdir(join(root, "work"), { recursive: true });
const scratch = await mkdtemp(join(root, "work/paseo-sdk-check-"));
try {
  await npmCommand(
    [
      "install",
      "--prefix",
      scratch,
      "--no-save",
      "--package-lock=false",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      ...["plugin", "client", "protocol"].map(
        (name) => `@getpaseo/${name}@${version}`,
      ),
    ],
    { timeout: 120000 },
  );
  const paths = {};
  for (const name of ["plugin", "client", "protocol"]) {
    const pkg = join(scratch, "node_modules/@getpaseo", name);
    const metadata = JSON.parse(
      await readFile(join(pkg, "package.json"), "utf8"),
    );
    if (metadata.version !== version)
      throw Error(`Unexpected ${name} SDK version`);
    paths[`@getpaseo/${name}`] = [join(pkg, "dist/index.d.ts")];
    paths[`@getpaseo/${name}/*`] = [join(pkg, "dist/*")];
  }
  const config = join(scratch, "tsconfig.json");
  await writeFile(
    config,
    JSON.stringify({
      extends: join(root, "tsconfig.json"),
      compilerOptions: { paths },
    }),
  );
  await exec(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--project",
      config,
      "--noEmit",
    ],
    { timeout: 120000 },
  );
  console.log(
    `Client/server/shared typecheck against Paseo ${version}; locked 0.12 tooling unchanged`,
  );
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
