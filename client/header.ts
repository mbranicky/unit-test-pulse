import type {
  PluginClientContext,
  PluginButtonRegistration,
} from "@getpaseo/plugin/client";
import { briefs } from "../shared/rpc";
import { RunningIcon } from "./ui";

export function watchHeaders(client: PluginClientContext) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const buttons = new Map<string, PluginButtonRegistration>();
  let workspaceIds: string[] = [];
  let refreshed = 0;
  const tick = async () => {
    try {
      if (Date.now() - refreshed > 30_000) {
        const ids: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.paseo.workspaces.list({
            page: { limit: 100, ...(cursor ? { cursor } : {}) },
          });
          ids.push(
            ...page.entries
              .filter((entry) => !entry.archivingAt)
              .map((entry) => entry.id),
          );
          cursor = page.pageInfo.hasMore
            ? page.pageInfo.nextCursor || undefined
            : undefined;
        } while (cursor && !stopped);
        workspaceIds = ids;
        refreshed = Date.now();
      }
      for (
        let offset = 0;
        offset < workspaceIds.length && !stopped;
        offset += 4
      ) {
        await Promise.allSettled(
          workspaceIds.slice(offset, offset + 4).map(async (id) => {
            const result = await client.rpc(briefs, { workspaceIds: [id] });
            if (stopped) return;
            const brief = result.workspaces[id];
            if (brief) {
              const icon = brief.running
                ? RunningIcon
                : ["failed", "error"].includes(brief.status)
                  ? "CircleX"
                  : brief.status === "passed"
                    ? "CircleCheck"
                    : "CircleMinus";
              const previous = buttons.get(id);
              if (previous)
                previous.update({ visible: true, label: brief.label, icon });
              else
                buttons.set(
                  id,
                  client.addHeaderButton({
                    id: "unit-test-run",
                    workspaceId: id,
                    button: {
                      title: "Open Unit Test Pulse",
                      icon,
                      label: brief.label,
                      behavior: {
                        kind: "action",
                        onPress: () =>
                          client.openPanel("pulse", {
                            workspaceId: id,
                            location: "explorer",
                          }),
                      },
                    },
                  }),
                );
            } else {
              buttons.get(id)?.remove();
              buttons.delete(id);
            }
          }),
        );
      }
      for (const [id, button] of buttons)
        if (!workspaceIds.includes(id)) {
          button.remove();
          buttons.delete(id);
        }
    } catch {
      /* Host reconnects are retried by the next poll. */
    }
    if (!stopped)
      timer = setTimeout(() => {
        void tick();
      }, 5000);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
