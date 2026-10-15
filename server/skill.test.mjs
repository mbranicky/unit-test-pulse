import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readlink,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill, skillStatus, skillPaths } from "./skill.mjs";

test("skill links install into user folders, follow edits and update only owned links", async () => {
  const home = await mkdtemp(join(tmpdir(), "pulse-skill-"));
  try {
    const source = join(home, "plugin", "skills", "unit-test-pulse");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "first");
    assert.equal(
      (await skillStatus(join(home, "plugin"), home)).state,
      "missing",
    );
    const paths = skillPaths(home);
    await mkdir(paths[1], { recursive: true });
    await writeFile(join(paths[1], "SKILL.md"), "user-owned");
    const installed = await installSkill(join(home, "plugin"), home);
    assert.deepEqual(
      installed.targets.map((item) => item.state),
      ["current", "foreign", "current"],
    );
    await writeFile(join(source, "SKILL.md"), "updated");
    assert.equal(await readFile(join(paths[0], "SKILL.md"), "utf8"), "updated");
    const next = join(home, "next", "skills", "unit-test-pulse");
    await mkdir(next, { recursive: true });
    await writeFile(join(next, "SKILL.md"), "next");
    assert.equal(
      (await skillStatus(join(home, "next"), home)).state,
      "outdated",
    );
    await installSkill(join(home, "next"), home);
    assert.equal(await readlink(paths[0]), next);
    assert.equal(
      await readFile(join(paths[1], "SKILL.md"), "utf8"),
      "user-owned",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("similar foreign symlinks and all-conflict targets are preserved", async () => {
  const home = await mkdtemp(join(tmpdir(), "pulse-skill-"));
  try {
    const source = join(home, "plugin", "skills", "unit-test-pulse");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "skill");
    for (const path of skillPaths(home)) {
      await mkdir(join(path, ".."), { recursive: true });
      await symlink(join(home, "other", "skills", "unit-test-pulse"), path);
    }
    assert.equal(
      (await skillStatus(join(home, "plugin"), home)).state,
      "foreign",
    );
    await assert.rejects(
      installSkill(join(home, "plugin"), home),
      /left unchanged/,
    );
    assert.equal(
      await readlink(skillPaths(home)[0]),
      join(home, "other", "skills", "unit-test-pulse"),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("simultaneous installation requests both finish with intact ownership records", async () => {
  const home = await mkdtemp(join(tmpdir(), "pulse-skill-"));
  try {
    const source = join(home, "plugin", "skills", "unit-test-pulse");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "skill");
    const results = await Promise.all([
      installSkill(join(home, "plugin"), home),
      installSkill(join(home, "plugin"), home),
    ]);
    assert.ok(results.every((result) => result.state === "current"));
    const owned = JSON.parse(
      await readFile(
        join(home, ".local", "share", "unit-test-pulse", "skill-links.json"),
        "utf8",
      ),
    );
    assert.ok(skillPaths(home).every((path) => owned[path] === source));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
