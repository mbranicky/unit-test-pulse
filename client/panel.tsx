import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  ScrollView,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import {
  useRpc,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { dashboard, diagnostics, specSource } from "../shared/rpc";
import { Action, Divider, StatusIcon, tone, live, basename } from "./ui";
import { AgentSetup } from "./setup";
import { RunSummary } from "./run-summary";
import { FileGroup } from "./file-group";
import { DetailModal } from "./detail-modal";
import { SourcePreview } from "./source-preview";
import { LogViewer } from "./log-viewer";
type Detail = {
  title: string;
  text?: string;
  source?: { file: string; text: string };
  testSource?: {
    file: string;
    text: string;
    startLine: number;
    endLine: number;
  };
  sourceNotice?: string;
  sourceFile?: string;
  logs?: { runId: string; testId?: string; fileId?: string };
};
export function PulsePanel({
  theme,
  host,
  workspaceId,
  layout,
  onSettings,
}: PluginWorkspacePanelProps & { onSettings(): void }) {
  const colors = theme.colors,
    read = useRpc(dashboard),
    report = useRpc(diagnostics),
    source = useRpc(specSource),
    toast = useToast();
  const [selected, setSelected] = useState<string>(),
    [history, setHistory] = useState(false),
    [setup, setSetup] = useState(false),
    [filter, setFilter] = useState<"all" | "failed" | "flaky" | "skipped">(
      "all",
    ),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [fileId, setFileId] = useState<string>(),
    [now, setNow] = useState(Date.now()),
    [detail, setDetail] = useState<Detail | null>(null);
  const query = useQuery({
    queryKey: [
      "unit-test-pulse",
      host.id,
      workspaceId,
      selected,
      filter,
      search,
      offset,
      fileId,
    ],
    queryFn: () =>
      read({ workspaceId, runId: selected, filter, search, offset, fileId }),
    // Keep the search field mounted while a new result page is loading.
    // Never carry another host, workspace, or selected run into this panel.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === host.id &&
      previousQuery.queryKey[2] === workspaceId &&
      previousQuery.queryKey[3] === selected
        ? previousData
        : undefined,
    refetchInterval: 2000,
  });
  useEffect(() => {
    setOffset(0);
  }, [filter, search, fileId, selected]);
  useEffect(() => {
    setSelected(undefined);
    setDetail(null);
    setFileId(undefined);
  }, [host.id, workspaceId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const data = query.data,
    run = data?.runs.find((r) => r.id === data.selectedId);
  async function details(testId?: string, selectedFileId?: string) {
    if (!run) return;
    setDetail({
      title: testId ? "Test details" : "Details",
      text: "Reading captured diagnostics…",
    });
    try {
      const result = await report({
        workspaceId,
        runId: run.id,
        testId,
        fileId: selectedFileId,
      });
      setDetail({
        title: testId
          ? "Test details"
          : selectedFileId
            ? "File details"
            : "Run report",
        text: result.text,
        testSource: result.source,
        sourceNotice: result.sourceNotice,
        sourceFile: result.sourceFile,
      });
    } catch (error) {
      setDetail({ title: "Details unavailable", text: String(error) });
    }
  }
  async function preview(file: string) {
    if (!run) return;
    setDetail({ title: basename(file), text: "Reading current source…" });
    try {
      setDetail({
        title: basename(file),
        source: await source({ workspaceId, runId: run.id, file }),
      });
    } catch (error) {
      setDetail({ title: "Source unavailable", text: String(error) });
    }
  }
  const rank = (status: string) =>
    status === "running" ? 0 : ["failed", "error"].includes(status) ? 1 : 2;
  const files = (run?.files || [])
    .filter(
      (f) =>
        (!fileId || f.id === fileId) &&
        (filter !== "failed" || f.failed > 0 || f.errors.length > 0) &&
        (filter === "all" ||
          filter === "failed" ||
          run?.tests.some((t) => t.fileId === f.id)) &&
        (!search ||
          `${f.file} ${f.project}`
            .toLowerCase()
            .includes(search.toLowerCase()) ||
          run?.tests.some((t) => t.fileId === f.id)),
    )
    .sort((a, b) => rank(a.status) - rank(b.status));
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }}>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          paddingHorizontal: 6,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Action
          label="Recent runs"
          icon="History"
          colors={colors}
          selected={history}
          onPress={() => setHistory((v) => !v)}
        />
        <View style={{ flex: 1 }} />
        <Action
          label="Settings"
          icon="Settings"
          colors={colors}
          onPress={onSettings}
        />
        <Action
          label="Agent setup"
          icon="Bot"
          colors={colors}
          selected={setup}
          onPress={() => setSetup((v) => !v)}
        />
        <Action
          label="Refresh"
          icon="RefreshCw"
          iconOnly
          colors={colors}
          onPress={() => {
            void query.refetch();
          }}
        />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: layout.compact ? 12 : 16, gap: 20 }}
      >
        <AgentSetup colors={colors} hostId={host.id} expanded={setup} />
        {history && data ? (
          <View style={{ gap: 4 }}>
            <Text
              style={{
                color: colors.foregroundMuted,
                fontSize: 11,
                marginBottom: 4,
              }}
            >
              RECENT RUNS
            </Text>
            {data.runs.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === run?.id }}
                onPress={() => {
                  setSelected(item.id);
                  setHistory(false);
                  setFileId(undefined);
                }}
                style={({ pressed }) => ({
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 8,
                  borderRadius: 6,
                  backgroundColor:
                    item.id === run?.id || pressed
                      ? colors.surface1
                      : "transparent",
                })}
              >
                <StatusIcon
                  status={item.status}
                  size={14}
                  color={tone(item.status, colors)}
                />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.foreground, fontSize: 12 }}
                  >
                    {basename(item.projectRoot)}
                  </Text>
                  <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>
                    {item.runner} · {item.mode} · {item.status}
                  </Text>
                </View>
                <Text
                  style={{
                    color: colors.foregroundMuted,
                    fontSize: 10,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {new Date(item.startedAt || item.updatedAt).toLocaleString(
                    undefined,
                    {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}
                </Text>
              </Pressable>
            ))}
            {selected ? (
              <Action
                label="Follow latest run"
                colors={colors}
                onPress={() => {
                  setSelected(undefined);
                  setHistory(false);
                  setFileId(undefined);
                }}
              />
            ) : null}
            <Divider colors={colors} />
          </View>
        ) : null}
        {query.error ? (
          <Text selectable style={{ color: colors.statusDanger, fontSize: 12 }}>
            {query.error.message}
          </Text>
        ) : null}
        {data?.notices.map((n, i) => (
          <Text
            key={i}
            selectable
            style={{ color: colors.statusWarning, fontSize: 12 }}
          >
            {n}
          </Text>
        ))}
        {run ? (
          <>
            <RunSummary run={run} colors={colors} now={now} />
            {run.notices.map((n, i) => (
              <Text
                key={i}
                selectable
                style={{
                  color: colors.foregroundMuted,
                  fontSize: 11,
                  lineHeight: 17,
                }}
              >
                {n}
              </Text>
            ))}
            {run.errors.map((e, i) => (
              <Text
                key={i}
                selectable
                style={{ color: colors.statusDanger, fontSize: 12 }}
              >
                {e.message}
              </Text>
            ))}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Action
                label="Run output"
                icon="Logs"
                colors={colors}
                onPress={() =>
                  setDetail({ title: "Run output", logs: { runId: run.id } })
                }
              />
              <Action
                label="Run report"
                icon="FileText"
                colors={colors}
                onPress={() => {
                  void details();
                }}
              />
            </View>
            <Divider colors={colors} />
            <View style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    flexGrow: 1,
                    flexShrink: 0,
                    color: colors.foreground,
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                >
                  Test files
                </Text>
                <View style={{ maxWidth: "100%", flexShrink: 0 }}>
                  <ScrollView
                    horizontal
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={{ flexDirection: "row", gap: 2 }}
                  >
                    {(["all", "failed", "flaky", "skipped"] as const).map(
                      (value) => (
                        <Action
                          key={value}
                          label={
                            value === "skipped"
                              ? "Skipped / Todo"
                              : value[0].toUpperCase() + value.slice(1)
                          }
                          colors={colors}
                          selected={filter === value}
                          onPress={() => setFilter(value)}
                        />
                      ),
                    )}
                  </ScrollView>
                </View>
              </View>
              <TextInput
                accessibilityLabel="Search tests and files"
                placeholder="Search tests and files"
                placeholderTextColor={colors.foregroundMuted}
                value={search}
                onChangeText={setSearch}
                style={{
                  minHeight: 40,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 6,
                  paddingHorizontal: 10,
                  color: colors.foreground,
                  backgroundColor: colors.surface1,
                }}
              />
              {fileId ? (
                <Action
                  label="Show all files"
                  icon="ArrowLeft"
                  colors={colors}
                  onPress={() => setFileId(undefined)}
                />
              ) : null}
              {files.map((file) => (
                <FileGroup
                  key={`${run.id}:${file.id}`}
                  file={file}
                  tests={run.tests.filter((t) => t.fileId === file.id)}
                  root={run.projectRoot}
                  colors={colors}
                  onSource={() => {
                    void preview(file.file);
                  }}
                  onDetails={() => {
                    void details(undefined, file.id);
                  }}
                  onTest={(test) => {
                    void details(test.id);
                  }}
                  onLogs={(test) =>
                    setDetail({
                      title: test
                        ? `Logs · ${test.title}`
                        : `Logs · ${basename(file.file)}`,
                      logs: {
                        runId: run.id,
                        ...(test ? { testId: test.id } : { fileId: file.id }),
                      },
                    })
                  }
                  onLoad={() => {
                    setFileId(file.id);
                    setFilter("all");
                    setSearch("");
                    setOffset(0);
                  }}
                />
              ))}
              {!files.length ? (
                <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                  {live(run)
                    ? "Waiting for test collection…"
                    : "No matching test files."}
                </Text>
              ) : null}
            </View>
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
                {data?.matching || 0} matching tests · page{" "}
                {Math.floor(offset / 200) + 1}
              </Text>
              {offset > 0 ? (
                <Action
                  label="Previous"
                  colors={colors}
                  onPress={() => setOffset(Math.max(0, offset - 200))}
                />
              ) : null}
              {data?.next !== null && data?.next !== undefined ? (
                <Action
                  label="Next"
                  colors={colors}
                  onPress={() => setOffset(data.next || 0)}
                />
              ) : null}
            </View>
          </>
        ) : (
          <View style={{ gap: 12 }}>
            <Text
              style={{
                color: colors.foreground,
                fontSize: 18,
                fontWeight: "600",
              }}
            >
              {query.isLoading
                ? "Loading test runs…"
                : "Ready to follow your unit tests"}
            </Text>
            <Text
              style={{
                color: colors.foregroundMuted,
                fontSize: 13,
                lineHeight: 20,
              }}
            >
              Use the Unit Test Pulse skill to run Vitest, Jest, Mocha, or
              Node.js tests with your project’s usual environment and test
              selection. Results, stacks, and captured logs will appear here.
            </Text>
            {data?.helper ? (
              <Text
                selectable
                style={{
                  color: colors.foregroundMuted,
                  fontSize: 11,
                  lineHeight: 18,
                  fontFamily: "monospace",
                }}
              >
                node {data.helper} doctor --project /absolute/project/path
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>
      <DetailModal
        title={detail?.title || "Details"}
        open={!!detail}
        wide
        colors={colors}
        close={() => setDetail(null)}
      >
        {detail?.logs ? (
          <LogViewer
            key={`${detail.logs.runId}:${detail.logs.testId || detail.logs.fileId || "run"}`}
            workspaceId={workspaceId}
            hostId={host.id}
            {...detail.logs}
            colors={colors}
          />
        ) : detail?.source ? (
          <SourcePreview {...detail.source} colors={colors} />
        ) : (
          <View style={{ gap: 12 }}>
            {detail?.testSource || detail?.sourceNotice ? (
              <View style={{ gap: 12 }}>
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                >
                  Test source
                </Text>
                {detail.testSource ? (
                  <SourcePreview {...detail.testSource} colors={colors} />
                ) : (
                  <Text
                    style={{
                      color: colors.foregroundMuted,
                      fontSize: 12,
                      lineHeight: 19,
                    }}
                  >
                    {detail.sourceNotice}
                  </Text>
                )}
                {detail.sourceFile ? (
                  <View style={{ alignSelf: "flex-start" }}>
                    <Action
                      label="Open full file"
                      icon="FileCode"
                      colors={colors}
                      onPress={() => {
                        void preview(detail.sourceFile!);
                      }}
                    />
                  </View>
                ) : null}
                <Divider colors={colors} />
              </View>
            ) : null}
            <Action
              label="Copy report"
              icon="Copy"
              colors={colors}
              onPress={() => {
                void copyText(detail?.text || "")
                  .then(() => toast.show("Report copied"))
                  .catch(() => toast.error("Could not copy the report."));
              }}
            />
            <Text
              selectable
              style={{
                color: colors.foreground,
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: 19,
              }}
            >
              {detail?.text}
            </Text>
          </View>
        )}
      </DetailModal>
    </View>
  );
}
