import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveRun,
  readRun,
  listRuns,
  runFolder,
  logWriter,
  readLogs,
} from "./store.mjs";
import { readSource } from "./source.mjs";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pulse-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  mkdirSync(project);
  const run = {
    id: "a".repeat(32),
    projectRoot: project,
    ownerPid: process.pid,
    endedAt: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    notices: [],
    files: [],
  };
  saveRun(run, root);
  return { root, project, run };
}
test("run reads require workspace ownership and valid identity", (t) => {
  const f = fixture(t);
  assert.equal(readRun(f.run.id, f.project, f.root).id, f.run.id);
  assert.throws(() => readRun("../secrets", f.project, f.root), /identity/);
  const other = join(f.root, "other");
  mkdirSync(other);
  assert.throws(() => readRun(f.run.id, other, f.root), /workspace/);
});
test("log paging, attribution, search, and follow-tail preserve repeated records", (t) => {
  const f = fixture(t),
    write = logWriter(f.run.id, f.root);
  for (let n = 0; n < 250; n++)
    write({
      stream: "console",
      text: `message ${n}`,
      testId: n % 2 ? "one" : "two",
    });
  const first = readLogs(f.run.id, f.project, { testId: "one" }, f.root);
  assert.equal(first.entries.length, 100);
  const next = readLogs(
    f.run.id,
    f.project,
    { testId: "one", cursor: first.next },
    f.root,
  );
  assert.equal(next.entries.length, 25);
  const tail = readLogs(f.run.id, f.project, { tail: true }, f.root);
  assert.equal(tail.entries[0].sequence, 151);
  assert.equal(tail.next, null);
  const search = readLogs(
    f.run.id,
    f.project,
    { search: "message 249" },
    f.root,
  );
  assert.equal(search.entries.length, 1);
});
test("large records announce truncation without stopping result collection", (t) => {
  const f = fixture(t),
    notices = [],
    write = logWriter(f.run.id, f.root, (n) => notices.push(n));
  write({ stream: "stdout", text: "a".repeat(300000) });
  const result = readLogs(f.run.id, f.project, {}, f.root);
  assert.equal(result.entries[0].truncated, true);
  assert.ok(notices.length);
});
test("source preview requires a known file and rejects symlink escape", async (t) => {
  const f = fixture(t),
    source = join(f.project, "example.ts");
  writeFileSync(source, "export const example = 1;");
  f.run.files = [{ file: source }];
  assert.match((await readSource(f.run, source, f.project)).text, /example/);
  await assert.rejects(
    readSource(f.run, join(f.project, "unknown.ts"), f.project),
    /part of/,
  );
  const outside = join(f.root, "private.ts");
  writeFileSync(outside, "secret");
  const link = join(f.project, "escape.ts");
  symlinkSync(outside, link);
  f.run.files.push({ file: link });
  await assert.rejects(readSource(f.run, link, f.project), /outside/);
});

test("removed projects and unrelated worktrees are omitted without deleting their history", (t) => {
  const f = fixture(t);
  const nested = join(f.project, "removed-package");
  const worktree = join(f.root, "removed-worktree");
  const project = join(worktree, "package");
  mkdirSync(nested);
  mkdirSync(project, { recursive: true });
  const ids = ["b".repeat(32), "c".repeat(32)];
  saveRun({ ...f.run, id: ids[0], projectRoot: nested }, f.root);
  saveRun({ ...f.run, id: ids[1], projectRoot: project }, f.root);
  rmSync(nested, { recursive: true });
  rmSync(worktree, { recursive: true });
  const result = listRuns(f.project, f.root);
  assert.deepEqual(
    result.runs.map((run) => run.id),
    [f.run.id],
  );
  assert.deepEqual(result.notices, []);
  assert.ok(
    ids.every((id) => existsSync(join(runFolder(id, f.root), "summary.json"))),
  );
  assert.throws(() => readRun(ids[0], f.project, f.root), {
    code: "RUN_PROJECT_MISSING",
  });
});

test("a former project directory replaced by a file is treated as unavailable", (t) => {
  const f = fixture(t);
  const parent = join(f.project, "removed-parent");
  const project = join(parent, "package");
  mkdirSync(project, { recursive: true });
  const id = "b".repeat(32);
  saveRun({ ...f.run, id, projectRoot: project }, f.root);
  rmSync(parent, { recursive: true });
  writeFileSync(parent, "replaced");
  assert.deepEqual(listRuns(f.project, f.root).notices, []);
  assert.throws(() => readRun(id, f.project, f.root), {
    code: "RUN_PROJECT_MISSING",
  });
});

test("history records missing during creation or cleanup do not produce warnings", (t) => {
  const f = fixture(t);
  mkdirSync(runFolder("b".repeat(32), f.root));
  const result = listRuns(f.project, f.root);
  assert.deepEqual(
    result.runs.map((run) => run.id),
    [f.run.id],
  );
  assert.deepEqual(result.notices, []);
});

test("damaged records and unexpected filesystem errors still produce notices", (t) => {
  const f = fixture(t);
  const corrupt = "b".repeat(32);
  mkdirSync(runFolder(corrupt, f.root));
  writeFileSync(join(runFolder(corrupt, f.root), "summary.json"), "{broken");
  const loop = join(f.project, "loop");
  symlinkSync(loop, loop);
  const unreadable = "c".repeat(32);
  saveRun({ ...f.run, id: unreadable, projectRoot: loop }, f.root);
  const mismatched = "d".repeat(32);
  mkdirSync(runFolder(mismatched, f.root));
  writeFileSync(
    join(runFolder(mismatched, f.root), "summary.json"),
    JSON.stringify(f.run),
  );
  const result = listRuns(f.project, f.root);
  assert.deepEqual(
    result.runs.map((run) => run.id),
    [f.run.id],
  );
  assert.equal(result.notices.length, 3);
  assert.ok(result.notices.some((notice) => notice.includes(mismatched)));
  assert.ok(result.notices.some((notice) => notice.includes(corrupt)));
  assert.ok(
    result.notices.some(
      (notice) => notice.includes(unreadable) && notice.includes("ELOOP"),
    ),
  );
});

test("workspace scoping still follows real paths and missing selected workspaces fail explicitly", (t) => {
  const f = fixture(t);
  const alias = join(f.root, "workspace-alias");
  symlinkSync(f.project, alias, "dir");
  assert.equal(listRuns(alias, f.root).runs[0].id, f.run.id);
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  const escaped = join(f.project, "escaped-project");
  symlinkSync(outside, escaped, "dir");
  const id = "b".repeat(32);
  saveRun({ ...f.run, id, projectRoot: escaped }, f.root);
  assert.throws(() => readRun(id, f.project, f.root), /workspace/);
  assert.deepEqual(listRuns(f.project, f.root).notices, []);
  assert.throws(() => listRuns(join(f.root, "missing-workspace"), f.root), {
    code: "ENOENT",
  });
});
