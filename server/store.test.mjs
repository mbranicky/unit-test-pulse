import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRun, readRun, logWriter, readLogs } from "./store.mjs";
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
