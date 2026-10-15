import type { ReactNode } from "react";
import {
  Modal as NativeModal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { Action, type Colors } from "./ui";

/** Paseo 0.11's modal has a fixed desktop width. Keep its native sheet on small screens. */
export function DetailModal({
  title,
  open,
  wide,
  close,
  colors,
  children,
}: {
  title: string;
  open: boolean;
  wide: boolean;
  close(): void;
  colors: Colors;
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  if (!wide || width < 720)
    return (
      <Modal
        title={title}
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Modal.Content>{children}</Modal.Content>
      </Modal>
    );
  return (
    <NativeModal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss preview"
          onPress={close}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: colors.surface0,
            opacity: 0.82,
          }}
        />
        <View
          accessibilityViewIsModal
          style={{
            width: Math.min(1120, width - 48),
            maxHeight: Math.max(240, height - 64),
            backgroundColor: colors.surface0,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 20,
              paddingVertical: 8,
              gap: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={{
                flex: 1,
                fontSize: 15,
                fontWeight: "600",
                color: colors.foreground,
              }}
            >
              {title}
            </Text>
            <Action label="Close" icon="X" colors={colors} onPress={close} />
          </View>
          <ScrollView
            style={{ maxHeight: Math.max(180, height - 144) }}
            contentContainerStyle={{ padding: 24, gap: 16 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </NativeModal>
  );
}
