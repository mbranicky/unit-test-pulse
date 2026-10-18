import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  dashboard,
  briefs,
  diagnostics,
  logs,
  specSource,
  skillStatus,
  installSkill,
} from "./shared/rpc";
import { listRuns, readRun, readLogs } from "./server/store.mjs";
import { readSource } from "./server/source.mjs";
import { readTestSource } from "./server/test-source.mjs";
import { failureText } from "./server/report.mjs";
import { installHelper, findPluginDirectory } from "./server/runtime";
import {
  skillStatus as readSkill,
  installSkill as linkSkill,
} from "./server/skill.mjs";
export default function contribute(server: PluginServerContext) {
  let helper: string | null = null,
    helperError: string | null = null;
  void installHelper()
    .then((path) => {
      helper = path;
    })
    .catch((error) => {
      helperError = error.message;
    });
  async function directory(paseo: any, id: string) {
    const workspace = await paseo.workspaces.ref(id).refresh();
    const path = workspace?.workspaceDirectory || workspace?.projectRootPath;
    if (!path) throw new Error("The selected workspace is unavailable.");
    return path;
  }
  const briefError = (error: any) => ({
    ...error,
    message: error.message?.slice(0, 4000),
    stack: undefined,
    diff: undefined,
    actual: undefined,
    expected: undefined,
  });
  server.handle(dashboard, async (input, { paseo }) => {
    const workspace = await directory(paseo, input.workspaceId);
    const { runs, notices } = listRuns(workspace);
    const picked = runs.find((run: any) => run.id === input.runId) || runs[0];
    const selected = picked ? readRun(picked.id, workspace) : undefined;
    const matching =
      selected?.tests
        .filter(
          (t: any) =>
            (!input.fileId || t.fileId === input.fileId) &&
            (input.filter === "all" ||
              (input.filter === "failed"
                ? t.status === "failed"
                : input.filter === "flaky"
                  ? t.status === "passed" && t.retry > 0
                  : ["skipped", "todo"].includes(t.status))) &&
            `${t.file} ${t.titlePath.join(" ")}`
              .toLowerCase()
              .includes(input.search.toLowerCase()),
        )
        .sort(
          (a: any, b: any) =>
            (({ running: 0, failed: 1, queued: 2 })[a.status as string] ?? 3) -
            ({ running: 0, failed: 1, queued: 2 }[b.status as string] ?? 3),
        ) || [];
    const visible = runs.slice(0, 30);
    if (selected && !visible.some((run: any) => run.id === selected.id))
      visible.push(selected);
    return {
      runs: visible.map((brief: any) => {
        const run = brief.id === selected?.id ? selected : brief;
        return {
          ...run,
          errors: run.errors.map(briefError),
          files:
            run === selected
              ? run.files.map((f: any) => ({
                  ...f,
                  errors: f.errors.map(briefError),
                }))
              : [],
          tests:
            run === selected
              ? matching
                  .slice(input.offset, input.offset + 200)
                  .map((t: any) => ({ ...t, errors: t.errors.map(briefError) }))
              : [],
        };
      }),
      selectedId: selected?.id || null,
      matching: matching.length,
      next: input.offset + 200 < matching.length ? input.offset + 200 : null,
      notices: [...notices, ...(helperError ? [helperError] : [])],
      helper,
    };
  });
  server.handle(briefs, async (input, { paseo }) => {
    const workspaces: Record<
      string,
      { status: string; running: number; label: string }
    > = {};
    for (const id of input.workspaceIds) {
      try {
        const { runs } = listRuns(await directory(paseo, id));
        const active = runs.filter(
          (r: any) => !r.endedAt && ["running", "starting"].includes(r.status),
        );
        const run =
          active[0] ||
          runs.find((r: any) => r.watching) ||
          runs.find(
            (r: any) =>
              r.endedAt && Date.now() - Date.parse(r.endedAt) < 120000,
          );
        if (run)
          workspaces[id] = {
            status: run.status,
            running: active.length,
            label:
              active.length > 1
                ? `Unit tests · ${active.length} runs`
                : run.watching && run.endedAt
                  ? `Unit tests · watching · ${run.status}`
                  : `Unit tests · ${run.completed}${run.totalComplete ? `/${run.total}` : " known"} · ${run.failed ? "failed" : run.status}`,
          };
      } catch {
        /* A workspace may disappear during polling. */
      }
    }
    return { workspaces };
  });
  server.handle(logs, async (input, { paseo }) =>
    readLogs(input.runId, await directory(paseo, input.workspaceId), input),
  );
  server.handle(diagnostics, async (input, { paseo }) => {
    const workspace = await directory(paseo, input.workspaceId);
    const run = readRun(input.runId, workspace);
    const page = readLogs(input.runId, workspace, {
      testId: input.testId,
      fileId: input.fileId,
      limit: 20,
    });
    const output = page.entries
      .map((entry: any) => `[${entry.stream}] ${entry.text}`)
      .join("\n")
      .slice(0, 32768);
    let source, sourceNotice;
    const sourceFile = input.testId
      ? run.tests.find((test: any) => test.id === input.testId)?.file
      : undefined;
    if (input.testId) {
      try {
        source = await readTestSource(
          run,
          input.testId,
          workspace,
          await findPluginDirectory(),
        );
      } catch (error) {
        sourceNotice = `Test source unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return {
      source,
      sourceNotice,
      sourceFile,
      text:
        failureText(run, input) +
        (output
          ? `\n\n## Captured output excerpt (up to 20 records / 32 KiB)\n${output}\nOpen Logs for the captured stream and any further records.`
          : "\n\nNo captured output at this scope. Open Run output for unassigned process output."),
    };
  });
  server.handle(specSource, async (input, { paseo }) => {
    const workspace = await directory(paseo, input.workspaceId);
    return readSource(readRun(input.runId, workspace), input.file, workspace);
  });
  server.handle(skillStatus, async () =>
    readSkill(await findPluginDirectory()),
  );
  server.handle(installSkill, async () =>
    linkSkill(await findPluginDirectory()),
  );
  return () => {};
}
