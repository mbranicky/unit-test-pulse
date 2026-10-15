import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PulsePanel } from "./client/panel";
import { watchHeaders } from "./client/header";
import { DiagnosticSettings } from "./client/settings";
export default function contribute(client: PluginClientContext) {
  const settings = client.addSettingsScreen({
    id: "diagnostics",
    title: "Diagnostics and history",
    icon: "SlidersHorizontal",
    Component: DiagnosticSettings,
  });
  const panel = client.addWorkspacePanel({
    id: "pulse",
    title: "Unit Test Pulse",
    icon: "Activity",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: (props) => (
      <PulsePanel
        {...props}
        onSettings={() => client.openSettings("diagnostics")}
      />
    ),
  });
  const command = client.addCommandCenterItem({
    id: "open-unit-test-pulse",
    title: "Open Unit Test Pulse",
    icon: "Activity",
    keywords: ["tests", "unit", "vitest", "jest"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("pulse", { location: "explorer" });
    },
  });
  const stop = watchHeaders(client);
  return () => {
    stop();
    void command();
    void panel();
    void settings();
  };
}
