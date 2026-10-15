import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
export function DiagnosticSettings({ theme }: PluginSurfaceProps) {
  const colors = theme.colors;
  return (
    <View style={{ padding: 20, gap: 16 }}>
      <Text
        style={{ color: colors.foreground, fontWeight: "600", fontSize: 18 }}
      >
        Diagnostics and history
      </Text>
      <Text
        style={{ color: colors.foregroundMuted, lineHeight: 21, fontSize: 13 }}
      >
        Captured output stays on the selected daemon host. It can contain
        application secrets. No cloud account is required.
      </Text>
      <Text style={{ color: colors.foreground, lineHeight: 22, fontSize: 13 }}>
        Current capture policy{"\n"}20 MiB process output per run{"\n"}20 MiB
        structured console output per run{"\n"}256 KiB per log record{"\n"}1 MiB
        source previews{"\n"}100 completed runs per project{"\n"}500 MiB
        completed-history budget
      </Text>
      <Text
        style={{ color: colors.foregroundMuted, lineHeight: 21, fontSize: 12 }}
      >
        Limits are fixed in this first build. Reaching a capture limit leaves
        test results active and adds a notice. History cleanup runs when a
        helper exits and preserves active/watch records. Advanced reporting and
        configurable retention are planned.
      </Text>
      <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>
        Default state: ~/.local/state/unit-test-pulse{"\n"}Override:
        UNIT_TEST_PULSE_STATE_DIR
      </Text>
    </View>
  );
}
