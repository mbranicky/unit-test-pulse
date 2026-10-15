import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { logs } from "../shared/rpc";
import { Action, type Colors } from "./ui";
export function LogViewer({
  workspaceId,
  hostId,
  runId,
  testId,
  fileId,
  colors,
}: {
  workspaceId: string;
  hostId: string;
  runId: string;
  testId?: string;
  fileId?: string;
  colors: Colors;
}) {
  const read = useRpc(logs),
    toast = useToast();
  const [cursor, setCursor] = useState(0),
    [tail, setTail] = useState(true),
    [search, setSearch] = useState(""),
    [stream, setStream] = useState<
      "console" | "stdout" | "stderr" | undefined
    >();
  const query = useQuery({
    queryKey: [
      "unit-test-pulse",
      "logs",
      hostId,
      workspaceId,
      runId,
      testId,
      fileId,
      cursor,
      search,
      stream,
      tail,
    ],
    queryFn: () =>
      read({
        workspaceId,
        runId,
        testId,
        fileId,
        cursor,
        search,
        stream,
        tail,
      }),
    refetchInterval: tail ? 2000 : false,
  });
  const entries = query.data?.entries || [];
  useEffect(() => setCursor(0), [search, stream]);
  return (
    <View style={{ gap: 12 }}>
      <Text
        style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}
      >
        {testId
          ? "Only explicitly test-attributed console output appears here. Unassigned stdout/stderr remains in Run output."
          : fileId
            ? "File-attributed console output. Jest may supply it only when the file finishes."
            : "Process output and structured console records are separate captures; repeated text can appear in both."}
      </Text>
      <TextInput
        accessibilityLabel="Search captured logs"
        placeholder="Search captured logs"
        placeholderTextColor={colors.foregroundMuted}
        value={search}
        onChangeText={setSearch}
        style={{
          minHeight: 40,
          paddingHorizontal: 10,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 6,
          color: colors.foreground,
          backgroundColor: colors.surface1,
        }}
      />
      <View style={{ flexDirection: "row", gap: 3, flexWrap: "wrap" }}>
        {(
          [
            undefined,
            "console",
            ...(!testId && !fileId ? ["stdout", "stderr"] : []),
          ] as const
        ).map((value) => (
          <Action
            key={value || "all"}
            label={value || "All output"}
            colors={colors}
            selected={stream === value}
            onPress={() => setStream(value as typeof stream)}
          />
        ))}
        <Action
          label={tail ? "Following latest" : "Follow latest"}
          colors={colors}
          selected={tail}
          onPress={() => {
            setTail((v) => !v);
            setCursor(0);
          }}
        />
        <Action
          label="Copy page"
          icon="Copy"
          colors={colors}
          disabled={!entries.length}
          onPress={() => {
            void copyText(
              entries
                .map(
                  (e) =>
                    `[${e.stream}${e.level ? `/${e.level}` : ""}] ${e.text}`,
                )
                .join("\n"),
            )
              .then(() => toast.show("Captured log page copied"))
              .catch(() => toast.error("Could not copy logs."));
          }}
        />
      </View>
      {query.error ? (
        <Text selectable style={{ color: colors.statusDanger }}>
          {query.error.message}
        </Text>
      ) : null}
      {!entries.length ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {query.isLoading
            ? "Reading captured output…"
            : "No matching captured output. It may be suppressed or unavailable at this scope."}
        </Text>
      ) : null}
      {entries.map((entry) => (
        <View
          key={entry.sequence}
          style={{
            gap: 4,
            padding: 10,
            borderRadius: 6,
            backgroundColor: colors.surface1,
          }}
        >
          <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>
            #{entry.sequence} · {entry.stream}
            {entry.level ? ` · ${entry.level}` : ""} ·{" "}
            {entry.testId ? "test" : entry.fileId ? "file" : "run/session"}
            {entry.truncated ? " · truncated" : ""}
          </Text>
          <Text
            selectable
            style={{
              color:
                entry.stream === "stderr"
                  ? colors.statusWarning
                  : colors.foreground,
              fontFamily: "monospace",
              fontSize: 11,
              lineHeight: 17,
            }}
          >
            {entry.text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")}
          </Text>
        </View>
      ))}
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
        {tail
          ? "Showing the latest 100 matching records. Pause following to browse from the beginning."
          : "Showing up to 100 records per page."}
      </Text>
      {!tail ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Action
            label="Beginning"
            colors={colors}
            disabled={cursor === 0}
            onPress={() => setCursor(0)}
          />
          <Action
            label="Next page"
            colors={colors}
            disabled={!query.data?.next}
            onPress={() => setCursor(query.data?.next || 0)}
          />
        </View>
      ) : null}
    </View>
  );
}
