import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PulseTest } from "../shared/rpc";
import { Action, tone, StatusIcon, type Colors } from "./ui";
export function TestRow({
  test,
  colors,
  onDetails,
  onLogs,
}: {
  test: PulseTest;
  colors: Colors;
  onDetails(): void;
  onLogs(): void;
}) {
  const [expanded, setExpanded] = useState(test.status === "failed");
  const status =
    test.status === "passed" && test.retry > 0 ? "flaky" : test.status;
  return (
    <View
      style={{
        paddingVertical: 5,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${test.title}, ${status}. ${expanded ? "Collapse" : "Expand"} details`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          backgroundColor: pressed ? colors.surface2 : "transparent",
          borderRadius: 6,
        })}
      >
        <StatusIcon
          status={test.status}
          color={
            status === "flaky"
              ? colors.statusWarning
              : tone(test.status, colors)
          }
        />
        <View style={{ flex: 1, gap: 3 }}>
          {test.titlePath.length > 1 ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>
              {test.titlePath.slice(0, -1).join(" › ")}
            </Text>
          ) : null}
          <Text
            style={{
              color: colors.foreground,
              fontSize: 12,
              fontWeight: test.status === "failed" ? "600" : "400",
            }}
          >
            {test.title}
            {status === "flaky" ? " · flaky" : ""}
            {["todo", "skipped", "cancelled"].includes(status)
              ? ` · ${status}`
              : ""}
          </Text>
        </View>
        <Text
          style={{
            color: colors.foregroundMuted,
            fontSize: 10,
            fontVariant: ["tabular-nums"],
          }}
        >
          {test.duration === null
            ? "—"
            : test.duration < 1000
              ? `${Math.round(test.duration)} ms`
              : `${(test.duration / 1000).toFixed(2)} s`}
        </Text>
        <Icon
          name={expanded ? "ChevronUp" : "ChevronDown"}
          size={12}
          color={colors.foregroundMuted}
        />
      </Pressable>
      {expanded ? (
        <View style={{ paddingLeft: 22, gap: 7, paddingBottom: 5 }}>
          {test.errors[0]?.message ? (
            <Text
              selectable
              style={{
                color: colors.foreground,
                fontFamily: "monospace",
                fontSize: 11,
                lineHeight: 17,
                padding: 10,
                borderRadius: 6,
                backgroundColor: colors.surface2,
              }}
            >
              {test.errors[0].message}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Action
              label={
                test.errors.length ? "Stack trace & details" : "Test details"
              }
              icon="FileCode"
              colors={colors}
              onPress={onDetails}
            />
            <Action label="Logs" icon="Logs" colors={colors} onPress={onLogs} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
