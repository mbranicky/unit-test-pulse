import { key, plainError } from "./model.mjs";
export function vitestReporter(send) {
  const project = (module) =>
    `${module.project?.name || ""}:${module.project?.config?.root || ""}`;
  const fileInfo = (module) => ({
    id: key(project(module), module.moduleId),
    file: module.moduleId,
    project: module.project?.name || "",
  });
  const testInfo = (test) => {
    const file = fileInfo(test.module);
    const titles = [test.name];
    let parent = test.parent;
    while (parent && parent.type !== "module") {
      titles.unshift(parent.name);
      parent = parent.parent;
    }
    const result = test.result();
    const diagnostic = test.diagnostic();
    return {
      id: key(file.id, test.id),
      nativeId: test.id,
      fileId: file.id,
      file: file.file,
      project: file.project,
      title: test.name,
      titlePath: titles,
      status:
        result.state === "pending"
          ? "queued"
          : result.state === "skipped" && test.task?.mode === "todo"
            ? "todo"
            : result.state,
      nativeStatus: result.state,
      duration: diagnostic?.duration ?? null,
      retry: diagnostic?.retryCount || 0,
      errors: (result.errors || []).map(plainError),
      location: test.location || null,
    };
  };
  const collect = (module) => {
    for (const test of module.children.allTests())
      send({ type: "test", test: testInfo(test) });
  };
  let ctx;
  const identities = new Map();
  return {
    onInit(context) {
      ctx = context;
    },
    onTestRunStart(specifications) {
      send({
        type: "start",
        files: specifications.map((s) => ({
          id: key(
            `${s.project.name || ""}:${s.project.config.root}`,
            s.moduleId,
          ),
          file: s.moduleId,
          project: s.project.name || "",
        })),
      });
    },
    onTestModuleQueued(module) {
      send({ type: "file", file: { ...fileInfo(module), status: "running" } });
    },
    onTestModuleCollected(module) {
      const file = fileInfo(module);
      identities.set(module.id, { fileId: file.id });
      for (const test of module.children.allTests())
        identities.set(test.id, {
          fileId: file.id,
          testId: key(file.id, test.id),
        });
      collect(module);
    },
    onTestCaseReady(test) {
      send({ type: "test", test: { ...testInfo(test), status: "running" } });
    },
    onTestCaseResult(test) {
      send({ type: "test", test: testInfo(test) });
    },
    onTestModuleEnd(module) {
      collect(module);
      send({
        type: "file",
        file: {
          ...fileInfo(module),
          status: module.state(),
          errors: module.errors().map(plainError),
          duration: module.diagnostic()?.duration ?? null,
        },
      });
    },
    onUserConsoleLog(log) {
      const identity = identities.get(log.taskId) || {};
      send({
        type: "log",
        record: {
          stream: "console",
          level: log.type || null,
          text: log.content,
          nativeTaskId: log.taskId || null,
          ...identity,
        },
      });
    },
    onTestRunEnd(modules, errors, reason) {
      for (const module of modules) {
        collect(module);
        send({
          type: "file",
          file: {
            ...fileInfo(module),
            status: module.state(),
            errors: module.errors().map(plainError),
          },
        });
      }
      for (const error of errors)
        send({ type: "error", error: plainError(error) });
      send({
        type: "end",
        failed: reason === "failed",
        interrupted: reason === "interrupted",
        watching: ctx.config.watch,
      });
    },
  };
}
