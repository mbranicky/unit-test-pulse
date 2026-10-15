import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PulseFile, PulseTest } from "../shared/rpc";
import { Action, basename, tone, type Colors } from "./ui";
import { TestRow } from "./test-row";
export function FileGroup({
  file,
  tests,
  root,
  colors,
  onSource,
  onDetails,
  onTest,
  onLogs,
  onLoad,
}: {
  file: PulseFile;
  tests: PulseTest[];
  root: string;
  colors: Colors;
  onSource(): void;
  onDetails(): void;
  onTest(test: PulseTest): void;
  onLogs(test?: PulseTest): void;
  onLoad(): void;
}) {
  const [open, setOpen] = useState(
    file.failed > 0 ||
      ["running", "queued"].includes(file.status) ||
      file.errors.length > 0,
  );
  const relative = file.file.startsWith(root)
    ? file.file.slice(root.length + 1)
    : file.file;
  return (
    <View
      style={{
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: colors.surface1,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 8,
          borderLeftWidth: 3,
          borderLeftColor: tone(file.status, colors),
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${open ? "Collapse" : "Expand"} ${relative}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((v) => !v)}
          style={{
            minHeight: 54,
            minWidth: 40,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={colors.foregroundMuted}
          />
        </Pressable>
        <View style={{ flex: 1, paddingVertical: 7, gap: 2 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Preview ${relative}`}
            onPress={onSource}
            style={{ minHeight: 40, justifyContent: "center" }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {basename(relative)} ↗
            </Text>
            <Text
              style={{
                color: colors.foregroundMuted,
                fontSize: 10,
                lineHeight: 15,
              }}
            >
              {relative === basename(relative) ? file.project : relative}
              {file.project && relative !== basename(relative)
                ? ` · ${file.project}`
                : ""}
            </Text>
          </Pressable>
          <Text
            style={{
              color: file.failed ? colors.statusDanger : colors.foregroundMuted,
              fontSize: 10,
              fontVariant: ["tabular-nums"],
            }}
          >
            {file.completed} / {file.total} tests
            {file.failed ? ` · ${file.failed} failed` : ""}
            {file.status === "running" ? " · running" : ""}
          </Text>
        </View>
      </View>
      {open ? (
        <View style={{ paddingHorizontal: 8, paddingBottom: 5 }}>
          {file.errors.length ? (
            <>
              <Text
                selectable
                style={{ color: colors.statusDanger, fontSize: 12, padding: 8 }}
              >
                {file.errors[0].message}
              </Text>
              <Action
                label="File failure details"
                colors={colors}
                onPress={onDetails}
              />
            </>
          ) : null}
          {tests.map((test) => (
            <TestRow
              key={test.id}
              test={test}
              colors={colors}
              onDetails={() => onTest(test)}
              onLogs={() => onLogs(test)}
            />
          ))}
          {file.total > tests.length ? (
            <Action
              label={`Show ${file.total} tests in this file`}
              colors={colors}
              onPress={onLoad}
            />
          ) : null}
          <View style={{ alignItems: "flex-start" }}>
            <Action
              label="File logs"
              icon="Logs"
              colors={colors}
              onPress={() => onLogs()}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
