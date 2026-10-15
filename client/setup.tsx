import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { skillStatus, installSkill } from "../shared/rpc";
import { Action, type Colors } from "./ui";

export function AgentSetup({
  colors,
  hostId,
  expanded,
}: {
  colors: Colors;
  hostId: string;
  expanded: boolean;
}) {
  const read = useRpc(skillStatus);
  const install = useRpc(installSkill);
  const client = useQueryClient();
  const key = ["unit-test-pulse", "skill", hostId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => read({}),
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: () => install({}),
    onSuccess: (data) => {
      client.setQueryData(key, data);
    },
  });
  const status = query.data;
  if (
    !expanded &&
    !query.error &&
    !mutation.error &&
    (!status || status.state === "current")
  )
    return null;
  const actionable = status && ["missing", "outdated"].includes(status.state);
  return (
    <View
      style={{
        gap: 8,
        padding: 12,
        borderRadius: 8,
        backgroundColor: colors.surface1,
      }}
    >
      <Text
        style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}
      >
        {status?.state === "current"
          ? "Agent skill installed"
          : "Set up your agents"}
      </Text>
      <Text
        style={{ color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}
      >
        {status?.state === "current"
          ? "New agent sessions can use Unit Test Pulse. Linked instructions follow plugin updates."
          : status?.state === "foreign"
            ? "Existing skills belong to another installation. They have been left unchanged."
            : "The skill teaches agents to launch monitored tests without editing project configuration."}
      </Text>
      {status ? (
        <Text
          selectable
          style={{
            color: colors.foregroundMuted,
            fontSize: 11,
            lineHeight: 17,
          }}
        >
          {actionable
            ? "Adds skill links on this host in:"
            : "Skill folders on this host:"}
          {"\n"}
          {status.targets
            .map(
              (target) =>
                `${target.path.replace(/^.*?([\\/]\.(?:agents|claude|codex)[\\/]skills)[\\/]unit-test-pulse$/, "~$1")}${target.state === "foreign" ? " (existing skill; skipped)" : ""}`,
            )
            .join("\n")}
        </Text>
      ) : null}
      {actionable ? (
        <View style={{ alignSelf: "flex-start" }}>
          <Action
            label={
              mutation.isPending
                ? "Installing…"
                : status.state === "outdated"
                  ? "Update skill"
                  : "Install skill"
            }
            primary
            colors={colors}
            disabled={mutation.isPending}
            onPress={() => mutation.mutate()}
          />
        </View>
      ) : null}
      {query.error ? (
        <Action
          label="Retry setup check"
          colors={colors}
          disabled={query.isFetching}
          onPress={() => {
            void query.refetch();
          }}
        />
      ) : null}
      {query.error || mutation.error ? (
        <Text selectable style={{ color: colors.statusDanger, fontSize: 12 }}>
          {(mutation.error || query.error)?.message}
        </Text>
      ) : null}
    </View>
  );
}
