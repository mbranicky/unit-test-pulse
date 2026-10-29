import { useEffect, useState } from "react";
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
  const hasFailure = file.failed > 0 || file.errors.length > 0;
  const [open, setOpen] = useState(hasFailure);
  useEffect(() => {
    setOpen(hasFailure);
  }, [hasFailure]);
  const relative = file.file.startsWith(root)
    ? file.file.slice(root.length + 1)
    : file.file;
  const folder = relative.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  const subtitle = [folder, file.project].filter(Boolean).join(" · ");
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Collapse" : "Expand"} ${relative}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={{
          borderLeftWidth: 3,
          borderLeftColor: tone(file.status, colors),
          paddingRight: 12,
          paddingVertical: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            style={{
              width: 31,
              alignItems: "center",
              alignSelf: "flex-start",
              paddingTop: 2,
            }}
          >
            <Icon
              name={open ? "ChevronDown" : "ChevronRight"}
              size={14}
              color={colors.foregroundMuted}
            />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Preview ${relative}`}
              onPress={(event) => {
                event.stopPropagation();
                onSource();
              }}
              style={{
                alignSelf: "flex-start",
                maxWidth: "100%",
                minHeight: 18,
                justifyContent: "center",
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Text
                  style={{
                    flexShrink: 1,
                    color: colors.foreground,
                    fontWeight: "600",
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  {basename(relative)}
                </Text>
                <Icon
                  name="ArrowUpRight"
                  size={12}
                  color={colors.foregroundMuted}
                />
              </View>
            </Pressable>
            {subtitle ? (
              <Text
                numberOfLines={1}
                style={{
                  color: colors.foregroundMuted,
                  fontSize: 10,
                  lineHeight: 15,
                }}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <Text
          style={{
            marginLeft: 31,
            color: file.failed ? colors.statusDanger : colors.foregroundMuted,
            fontSize: 10,
            lineHeight: 15,
            fontVariant: ["tabular-nums"],
          }}
        >
          {file.completed} / {file.total} tests
          {file.failed ? ` · ${file.failed} failed` : ""}
          {file.status === "running" ? " · running" : ""}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 5 }}>
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
