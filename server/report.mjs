const strip = (text) => String(text).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
export function failureText(run, { testId, fileId } = {}) {
  const test = testId ? run.tests.find((t) => t.id === testId) : null;
  if (testId && !test)
    throw new Error("This test is not part of the selected run.");
  const file = fileId ? run.files.find((f) => f.id === fileId) : null;
  if (fileId && !file)
    throw new Error("This file is not part of the selected run.");
  const rows = [
    `# ${test ? test.titlePath.join(" › ") : file ? file.file : "Unit Test Pulse report"}`,
    `${run.runner} ${run.runnerVersion} · ${run.status} · ${run.id}`,
    `Project: ${run.projectRoot}`,
    `Cycle: ${run.cycle} · ${run.mode}`,
    `Captured outcomes: ${run.passed} passed, ${run.flaky} flaky, ${run.failed} failed, ${run.skipped} skipped, ${run.todo} todo, ${run.cancelled} cancelled`,
    `Collection: ${run.totalComplete ? "complete" : "partial or unknown"} · process exit: ${run.exitCode ?? "unavailable"}${run.signal ? ` · ${run.signal}` : ""}`,
  ];
  const errors = (e) =>
    [
      e.name,
      e.message,
      e.diff,
      ...(e.expected !== undefined ? [`Expected: ${e.expected}`] : []),
      ...(e.actual !== undefined ? [`Actual: ${e.actual}`] : []),
      e.stack,
    ]
      .filter(Boolean)
      .join("\n");
  if (test)
    rows.push(
      `File: ${test.file}`,
      `Status: ${test.status} · retries: ${test.retry}`,
      ...test.errors.map(errors),
    );
  else if (file)
    rows.push(
      ...file.errors.map(errors),
      ...run.tests
        .filter((t) => t.fileId === file.id && t.status === "failed")
        .flatMap((t) => [t.titlePath.join(" › "), ...t.errors.map(errors)]),
    );
  else {
    rows.push(...run.errors.map(errors));
    for (const f of run.files.filter((f) => f.errors.length))
      rows.push(`File: ${f.file}`, ...f.errors.map(errors));
    for (const t of run.tests.filter((t) => t.status === "failed"))
      rows.push(t.titlePath.join(" › "), ...t.errors.map(errors));
    const slow = run.tests
      .filter((t) => typeof t.duration === "number")
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);
    if (slow.length)
      rows.push(
        "## Slowest tests",
        ...slow.map(
          (t) => `${t.duration.toFixed(1)} ms · ${t.titlePath.join(" › ")}`,
        ),
      );
  }
  rows.push(...run.notices.map((n) => `Notice: ${n}`));
  const text = strip(rows.join("\n\n"));
  return text.length > 1024 * 1024
    ? text.slice(0, 1024 * 1024) +
        "\n[Report truncated at 1 MiB; request individual failures for full captured diagnostics.]"
    : text;
}
