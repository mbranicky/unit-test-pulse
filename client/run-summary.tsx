import { Text, View } from "react-native";
import type { PulseRun } from "../shared/rpc";
import { basename, duration, tone, StatusIcon, live, type Colors } from "./ui";
export function RunSummary({
  run,
  colors,
  now,
}: {
  run: PulseRun;
  colors: Colors;
  now: number;
}) {
  const labels: Record<string, string> = {
    starting: "Starting",
    running: "Running",
    passed: "Passed",
    failed: "Failed",
    error: "Run error",
    empty: "No executed tests",
    interrupted: "Interrupted",
  };
  const segments = [
    { status: "passed", count: run.passed },
    { status: "flaky", count: run.flaky },
    { status: "failed", count: run.failed },
    { status: "skipped", count: run.skipped },
    { status: "todo", count: run.todo },
    { status: "cancelled", count: run.cancelled },
  ];
  const color = (status: string) =>
    status === "flaky" ? colors.statusWarning : tone(status, colors);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <StatusIcon status={run.status} color={tone(run.status, colors)} />
        <Text
          style={{
            color: tone(run.status, colors),
            flex: 1,
            fontWeight: "600",
            fontSize: 14,
          }}
        >
          {labels[run.status] || run.status}
          {live(run) && run.failed ? ` · ${run.failed} failed` : ""}
        </Text>
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: 12,
            fontVariant: ["tabular-nums"],
          }}
        >
          {duration(
            (run.endedAt ? Date.parse(run.endedAt) : now) -
              Date.parse(run.startedAt),
          )}
        </Text>
      </View>
      <View style={{ gap: 5 }}>
        <Text
          style={{ color: colors.foreground, fontSize: 18, fontWeight: "600" }}
        >
          {basename(run.projectRoot)}
        </Text>
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
            lineHeight: 17,
          }}
        >
          {(
            {
              vitest: "Vitest",
              jest: "Jest",
              mocha: "Mocha",
              node: "Node.js",
            } as Record<string, string>
          )[run.runner] || run.runner}{" "}
          {run.runnerVersion} ·{" "}
          {run.mode === "watch" ? `Watch · cycle ${run.cycle}` : "One-shot run"}
        </Text>
        {run.watching && run.endedAt ? (
          <Text style={{ color: colors.accent, fontSize: 12 }}>
            Watching — idle
          </Text>
        ) : null}
      </View>
      {run.total > 0 ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: run.total,
            now: run.completed,
            text: `${run.completed} of ${run.total} ${run.totalComplete ? "" : "known "}tests completed`,
          }}
          style={{
            height: 7,
            flexDirection: "row",
            gap: 2,
            backgroundColor: colors.surface2,
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          {segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <View
                key={s.status}
                style={{
                  flexGrow: s.count,
                  flexBasis: 0,
                  backgroundColor: color(s.status),
                }}
              />
            ))}
          {run.total > run.completed ? (
            <View
              style={{ flexGrow: run.total - run.completed, flexBasis: 0 }}
            />
          ) : null}
        </View>
      ) : null}
      <Text
        style={{
          color: colors.foreground,
          fontSize: 12,
          fontVariant: ["tabular-nums"],
        }}
      >
        {run.completed} / {run.total}{" "}
        {run.totalComplete ? "tests completed" : "known tests completed"}
      </Text>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        {segments
          .filter((s) => s.count > 0 || ["passed", "failed"].includes(s.status))
          .map((s) => (
            <Text
              key={s.status}
              style={{
                color: color(s.status),
                fontSize: 12,
                fontVariant: ["tabular-nums"],
              }}
            >
              {s.count} {s.status}
            </Text>
          ))}
      </View>
      {run.retries > 0 ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
          {run.retries} reported retries · intermediate attempt details may be
          unavailable
        </Text>
      ) : null}
      {run.status === "error" && run.exitCode !== null ? (
        <Text style={{ color: colors.statusDanger, fontSize: 12 }}>
          Process exited with code {run.exitCode}. Inspect the report and run
          output.
        </Text>
      ) : null}
    </View>
  );
}
