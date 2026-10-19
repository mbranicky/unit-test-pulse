import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readFileSync,
  readdirSync,
  statSync,
  appendFileSync,
  realpathSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { stateRoot, inside } from "./environment.mjs";
export { inside };
export const validId = (id) =>
  typeof id === "string" && /^[a-f0-9]{24,36}$/.test(id);
export function atomic(file, data) {
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, file);
}
export function readJson(file, limit = 32 * 1024 * 1024) {
  if (statSync(file).size > limit)
    throw new Error("Stored data exceeds the read limit.");
  return JSON.parse(readFileSync(file, "utf8"));
}
export function runFolder(id, root = stateRoot()) {
  if (!validId(id)) throw new Error("Invalid run identity.");
  return join(root, "runs", id);
}
export function saveRun(run, root = stateRoot()) {
  const folder = runFolder(run.id, root);
  atomic(join(folder, "summary.json"), run);
  const { tests, files, ...brief } = run;
  atomic(join(folder, "brief.json"), { ...brief, tests: [], files: [] });
}
export function readRun(id, workspace, root = stateRoot(), brief = false) {
  const folder = runFolder(id, root);
  const run = readJson(
    join(
      folder,
      brief && existsSync(join(folder, "brief.json"))
        ? "brief.json"
        : "summary.json",
    ),
  );
  if (run.id !== id)
    throw new Error(
      "Stored run identity does not match its history directory.",
    );
  const workspacePath = realpathSync(workspace);
  let projectPath;
  try {
    projectPath = realpathSync(run.projectRoot);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR")
      throw Object.assign(
        new Error("The project for this saved run no longer exists."),
        {
          code: "RUN_PROJECT_MISSING",
        },
      );
    throw error;
  }
  if (!inside(workspacePath, projectPath))
    throw Object.assign(
      new Error("This run does not belong to the selected workspace."),
      {
        code: "RUN_WORKSPACE_MISMATCH",
      },
    );
  if (!run.endedAt) {
    try {
      process.kill(run.ownerPid, 0);
    } catch (error) {
      if (error.code === "ESRCH") {
        run.status = "interrupted";
        run.watching = false;
        run.notices.push(
          "The collector exited without a final record. Results may be incomplete.",
        );
      }
    }
  } else if (run.watching) {
    try {
      process.kill(run.ownerPid, 0);
    } catch {
      run.watching = false;
    }
  }
  return run;
}
export function listRuns(workspace, root = stateRoot()) {
  // The selected workspace must exist. Missing historical projects are expected
  // after worktree cleanup and are handled separately below.
  const workspacePath = realpathSync(workspace);
  let ids;
  try {
    ids = readdirSync(join(root, "runs"));
  } catch (error) {
    if (error.code === "ENOENT") return { runs: [], notices: [] };
    throw error;
  }
  const runs = [],
    notices = [];
  for (const id of ids.filter(validId)) {
    try {
      const run = readRun(id, workspacePath, root, true);
      runs.push(run);
    } catch (error) {
      // A project may have been removed, or a record may disappear between
      // directory enumeration and reading while retention cleanup runs.
      if (
        !["RUN_WORKSPACE_MISMATCH", "RUN_PROJECT_MISSING", "ENOENT"].includes(
          error.code,
        )
      )
        notices.push(`Could not read run ${id}: ${error.message}`);
    }
  }
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { runs, notices };
}
export function logWriter(id, root = stateRoot(), onLimit = () => {}) {
  const folder = runFolder(id, root);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const sizes = { process: 0, console: 0 },
    dropped = { process: 0, console: 0 };
  let sequence = 0;
  return (record) => {
    const group = record.stream === "console" ? "console" : "process";
    let text = String(record.text || "");
    const bytes = Buffer.byteLength(text);
    if (sizes[group] + bytes > 20 * 1024 * 1024) {
      dropped[group] += bytes;
      onLimit(
        `${group} capture limit reached; ${dropped[group]} output bytes omitted.`,
      );
      return;
    }
    let truncated = Boolean(record.truncated);
    if (bytes > 256 * 1024) {
      text = Buffer.from(text)
        .subarray(0, 256 * 1024)
        .toString("utf8");
      truncated = true;
      onLimit("A log record exceeded 256 KiB and was truncated.");
    }
    const serialized =
      JSON.stringify({
        ...record,
        text,
        truncated,
        sequence: ++sequence,
        receivedAt: new Date().toISOString(),
      }) + "\n";
    sizes[group] += Buffer.byteLength(serialized);
    appendFileSync(join(folder, "logs.jsonl"), serialized, { mode: 0o600 });
  };
}
/**
 * @param {string} id
 * @param {string} workspace
 * @param {{cursor?:number,limit?:number,tail?:boolean,testId?:string,fileId?:string,stream?:string,search?:string}} [options]
 * @param {string} [root]
 */
export function readLogs(
  id,
  workspace,
  {
    cursor = 0,
    limit = 100,
    tail = false,
    testId,
    fileId,
    stream,
    search = "",
  } = {},
  root = stateRoot(),
) {
  readRun(id, workspace, root);
  const file = join(runFolder(id, root), "logs.jsonl");
  let text;
  try {
    if (statSync(file).size > 64 * 1024 * 1024)
      throw new Error("Log file exceeds the read limit.");
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { entries: [], next: null };
    throw error;
  }
  const result = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      entry.sequence <= cursor ||
      (testId && entry.testId !== testId) ||
      (fileId && entry.fileId !== fileId) ||
      (stream && entry.stream !== stream) ||
      !entry.text.toLowerCase().includes(search.toLowerCase())
    )
      continue;
    result.push(entry);
    if (tail && result.length > limit) result.shift();
    else if (!tail && result.length > limit) break;
  }
  return {
    entries: result.slice(0, limit),
    next: !tail && result.length > limit ? result[limit - 1].sequence : null,
  };
}
export function prune(root = stateRoot()) {
  let ids;
  try {
    ids = readdirSync(join(root, "runs")).filter(validId);
  } catch {
    return;
  }
  const rows = ids
    .flatMap((id) => {
      try {
        const folder = runFolder(id, root),
          run = readJson(join(folder, "summary.json"));
        const size = readdirSync(folder).reduce(
          (n, f) => n + statSync(join(folder, f)).size,
          0,
        );
        return [{ id, run, size }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
  let total = rows.reduce((n, r) => n + r.size, 0);
  const perProject = new Map();
  const candidates = [];
  for (const row of rows) {
    const n = (perProject.get(row.run.projectRoot) || 0) + 1;
    perProject.set(row.run.projectRoot, n);
    if (row.run.endedAt && !row.run.watching)
      candidates.push({ ...row, overCount: n > 100 });
  }
  for (const row of candidates.reverse())
    if (row.overCount || total > 500 * 1024 * 1024) {
      rmSync(runFolder(row.id, root), { recursive: true });
      total -= row.size;
    }
}
