import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { PulseRun } from "../shared/rpc";

export type Colors = PluginWorkspacePanelProps["theme"]["colors"];
export const live = (run: PulseRun) =>
  ["running", "starting"].includes(run.status);
export const basename = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) || path;
export function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function tone(status: string, colors: Colors) {
  return status === "passed"
    ? colors.statusSuccess
    : ["failed", "error"].includes(status)
      ? colors.statusDanger
      : ["running", "starting"].includes(status)
        ? colors.accent
        : colors.foregroundMuted;
}
export function statusIcon(status: string) {
  return status === "passed"
    ? "Check"
    : ["failed", "error"].includes(status)
      ? "X"
      : ["running", "starting"].includes(status)
        ? "Activity"
        : "Minus";
}
export function RunningIcon({ color }: { color: string; size?: number }) {
  return (
    <ActivityIndicator
      size="small"
      color={color}
      accessibilityLabel="Tests in progress"
    />
  );
}
export function StatusIcon({
  status,
  color,
  size = 14,
}: {
  status: string;
  color: string;
  size?: number;
}) {
  return ["starting", "running"].includes(status) ? (
    <RunningIcon color={color} size={size} />
  ) : (
    <Icon name={statusIcon(status)} size={size} color={color} />
  );
}
export function Action({
  label,
  icon,
  onPress,
  colors,
  disabled = false,
  primary = false,
  selected = false,
  iconOnly = false,
}: {
  label: string;
  icon?: string;
  onPress(): void;
  colors: Colors;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
  iconOnly?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={(event) => {
        event.stopPropagation();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 40,
        minWidth: 40,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingHorizontal: icon ? 8 : 10,
        borderRadius: 6,
        backgroundColor: primary
          ? colors.accent
          : selected || pressed
            ? colors.surface2
            : "transparent",
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {icon ? (
        <Icon
          name={icon}
          size={14}
          color={primary ? colors.accentForeground : colors.foregroundMuted}
        />
      ) : null}
      {!iconOnly ? (
        <Text
          style={{
            color: primary ? colors.accentForeground : colors.foreground,
            fontSize: 12,
            fontWeight: selected || primary ? "600" : "400",
          }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}
export function Divider({ colors }: { colors: Colors }) {
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}
