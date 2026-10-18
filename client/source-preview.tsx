import { Text, View } from "react-native";
import {
  ScrollView,
  copyText,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { Action, type Colors } from "./ui";

export function SourcePreview({
  file,
  text,
  colors,
  startLine = 1,
  endLine,
}: {
  file: string;
  text: string;
  colors: Colors;
  startLine?: number;
  endLine?: number;
}) {
  const toast = useToast();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <View style={{ gap: 12 }}>
      <Text
        selectable
        style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 17 }}
      >
        {file}
        {endLine ? `:${startLine}–${endLine}` : ""}
        {"\n"}Read-only · current file contents
      </Text>
      <View style={{ alignSelf: "flex-start" }}>
        <Action
          label="Copy source"
          icon="Copy"
          colors={colors}
          onPress={() => {
            void copyText(text)
              .then(() => toast.show("Source copied"))
              .catch(() =>
                toast.error(
                  "Could not copy the source. Select the text to copy it.",
                ),
              );
          }}
        />
      </View>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ alignItems: "flex-start", gap: 16 }}
      >
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            color: colors.foregroundMuted,
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 19,
            textAlign: "right",
          }}
        >
          {lines.map((_, index) => index + startLine).join("\n")}
        </Text>
        <Text
          selectable
          style={{
            color: colors.foreground,
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 19,
          }}
        >
          {lines.join("\n")}
        </Text>
      </ScrollView>
    </View>
  );
}
