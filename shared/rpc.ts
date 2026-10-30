import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
const error = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  stack: z.string().optional(),
  diff: z.string().optional(),
  actual: z.string().optional(),
  expected: z.string().optional(),
});
export const testSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  file: z.string(),
  project: z.string(),
  title: z.string(),
  titlePath: z.array(z.string()),
  status: z.string(),
  nativeStatus: z.string().optional(),
  duration: z.number().nullable(),
  retry: z.number(),
  errors: z.array(error),
  location: z
    .object({ line: z.number(), column: z.number() })
    .nullable()
    .optional(),
});
const fileSchema = z.object({
  id: z.string(),
  file: z.string(),
  project: z.string(),
  status: z.string(),
  total: z.number(),
  completed: z.number(),
  failed: z.number(),
  duration: z.number().nullable(),
  errors: z.array(error),
});
export const runSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  sessionId: z.string(),
  cycle: z.number(),
  runner: z.string(),
  runnerVersion: z.string(),
  projectRoot: z.string(),
  workspaceRoot: z.string(),
  mode: z.string(),
  status: z.string(),
  watching: z.boolean(),
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().nullable(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  totalComplete: z.boolean(),
  total: z.number(),
  completed: z.number(),
  passed: z.number(),
  failed: z.number(),
  flaky: z.number(),
  skipped: z.number(),
  todo: z.number(),
  cancelled: z.number(),
  running: z.number(),
  queued: z.number(),
  retries: z.number(),
  errors: z.array(error),
  notices: z.array(z.string()),
  tests: z.array(testSchema),
  files: z.array(fileSchema),
});
export type PulseRun = z.infer<typeof runSchema>;
export type PulseTest = z.infer<typeof testSchema>;
export type PulseFile = z.infer<typeof fileSchema>;
const workspace = z.object({ workspaceId: z.string().min(1) });
const identity = workspace.extend({
  runId: z.string().regex(/^[a-f0-9]{32}$/),
});
export const FILE_PAGE_SIZE = 25;
export const TEST_PAGE_SIZE = 200;
export const dashboard = defineRpc({
  name: "dashboard.read",
  input: workspace.extend({
    runId: z.string().optional(),
    filter: z.enum(["all", "failed", "flaky", "skipped"]).default("all"),
    search: z.string().max(500).default(""),
    offset: z.number().int().min(0).default(0),
    fileId: z.string().optional(),
  }),
  output: z.object({
    runs: z.array(runSchema),
    selectedId: z.string().nullable(),
    matching: z.number(),
    matchingFiles: z.number(),
    next: z.number().nullable(),
    notices: z.array(z.string()),
    helper: z.string().nullable(),
  }),
});
export const briefs = defineRpc({
  name: "dashboard.briefs",
  input: z.object({ workspaceIds: z.array(z.string()).max(200) }),
  output: z.object({
    workspaces: z.record(
      z.string(),
      z.object({ status: z.string(), running: z.number(), label: z.string() }),
    ),
  }),
});
export const logs = defineRpc({
  name: "logs.read",
  input: identity.extend({
    cursor: z.number().int().min(0).default(0),
    tail: z.boolean().default(false),
    testId: z.string().optional(),
    fileId: z.string().optional(),
    stream: z.enum(["console", "stdout", "stderr"]).optional(),
    search: z.string().max(500).default(""),
  }),
  output: z.object({
    entries: z.array(
      z.object({
        sequence: z.number(),
        receivedAt: z.string(),
        text: z.string(),
        stream: z.string(),
        level: z.string().nullable().optional(),
        testId: z.string().optional(),
        fileId: z.string().optional(),
        truncated: z.boolean().optional(),
      }),
    ),
    next: z.number().nullable(),
  }),
});
export const diagnostics = defineRpc({
  name: "diagnostics.read",
  input: identity.extend({
    testId: z.string().optional(),
    fileId: z.string().optional(),
  }),
  output: z.object({
    text: z.string(),
    source: z
      .object({
        file: z.string(),
        text: z.string().max(1024 * 1024),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      })
      .optional(),
    sourceNotice: z.string().optional(),
    sourceFile: z.string().optional(),
  }),
});
export const specSource = defineRpc({
  name: "source.read",
  input: identity.extend({ file: z.string().min(1).max(4096) }),
  output: z.object({ file: z.string(), text: z.string().max(1024 * 1024) }),
});
const skillState = z.enum(["missing", "current", "outdated", "foreign"]);
const skillResult = z.object({
  state: skillState,
  targets: z.array(z.object({ path: z.string(), state: skillState })),
});
export const skillStatus = defineRpc({
  name: "skill.status",
  input: z.object({}),
  output: skillResult,
});
export const installSkill = defineRpc({
  name: "skill.install",
  input: z.object({}),
  output: skillResult,
});
