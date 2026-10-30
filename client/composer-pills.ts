import type {
  PluginClientContext,
  PluginButtonRegistration,
} from "@getpaseo/plugin/client";
import { briefs } from "../shared/rpc";

export function watchComposerPills(client: PluginClientContext) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pills = new Map<
    string,
    { workspaceId: string; registration: PluginButtonRegistration }
  >();
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
      // Pills belong to an agent composer. Read every page so new agents and
      // workspace moves are reflected without touching other plugins' pills.
      const agents: Array<{ id: string; workspaceId?: string | null }> = [];
      let cursor: string | undefined;
      do {
        const page = await client.paseo.agents.list({
          filter: { includeArchived: false },
          page: { limit: 100, ...(cursor ? { cursor } : {}) },
        });
        if (stopped) return;
        agents.push(...page.entries.map(({ agent }) => agent));
        cursor = page.pageInfo.hasMore
          ? page.pageInfo.nextCursor || undefined
          : undefined;
      } while (cursor && !stopped);
      const activeAgents = agents.filter(
        (agent) =>
          agent.workspaceId && workspaceIds.includes(agent.workspaceId),
      );
      for (const [agentId, pill] of pills) {
        if (
          !activeAgents.some(
            (agent) =>
              agent.id === agentId && agent.workspaceId === pill.workspaceId,
          )
        ) {
          pill.registration.remove();
          pills.delete(agentId);
        }
      }
      const targets = [
        ...new Set(activeAgents.map((agent) => agent.workspaceId!)),
      ];
      for (let offset = 0; offset < targets.length && !stopped; offset += 4) {
        await Promise.allSettled(
          targets.slice(offset, offset + 4).map(async (id) => {
            const result = await client.rpc(briefs, { workspaceIds: [id] });
            if (stopped) return;
            const brief = result.workspaces[id];
            if (brief) {
              const icon = brief.running
                ? "Activity"
                : ["failed", "error"].includes(brief.status)
                  ? "CircleX"
                  : brief.status === "passed"
                    ? "CircleCheck"
                    : "CircleMinus";
              for (const agent of activeAgents.filter(
                (agent) => agent.workspaceId === id,
              )) {
                const previous = pills.get(agent.id);
                if (previous) {
                  previous.registration.update({
                    visible: true,
                    label: brief.label,
                    icon,
                  });
                } else {
                  pills.set(agent.id, {
                    workspaceId: id,
                    registration: client.addComposerPill({
                      id: "unit-test-run",
                      workspaceId: id,
                      agentId: agent.id,
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
                  });
                }
              }
            } else {
              for (const [agentId, pill] of pills) {
                if (pill.workspaceId !== id) continue;
                pill.registration.remove();
                pills.delete(agentId);
              }
            }
          }),
        );
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
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
