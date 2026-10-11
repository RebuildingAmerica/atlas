import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTaxonomy } from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";
import { useConfirmDialog } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import {
  createDiscoverySchedule,
  deleteDiscoverySchedule,
  listDiscoverySchedules,
  setDiscoveryScheduleEnabled,
} from "./discovery-schedules.functions";
import { DiscoverySchedulesView } from "./discovery-schedules-view";

const SCHEDULES_QUERY_KEY = ["editorial", "discovery-schedules"] as const;

export function DiscoverySchedulesPage() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  const [formResetKey, setFormResetKey] = useState(0);
  const taxonomy = useTaxonomy();
  const schedules = useQuery({
    enabled: hydrated,
    queryFn: () => listDiscoverySchedules(),
    queryKey: SCHEDULES_QUERY_KEY,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: SCHEDULES_QUERY_KEY });
  const toggle = useMutation({ mutationFn: setDiscoveryScheduleEnabled, onSuccess: refresh });
  const remove = useMutation({ mutationFn: deleteDiscoverySchedule, onSuccess: refresh });
  const create = useMutation({
    mutationFn: createDiscoverySchedule,
    onSuccess: async () => {
      setFormResetKey((key) => key + 1);
      await refresh();
    },
  });
  const issueAreas = useMemo(
    () =>
      Object.values(taxonomy.data ?? {})
        .flat()
        .sort((left, right) => left.name.localeCompare(right.name)),
    [taxonomy.data],
  );
  const actionError = toggle.isError
    ? userFacingErrorMessage(toggle.error, "The schedule could not be changed.")
    : remove.isError
      ? userFacingErrorMessage(remove.error, "The schedule could not be removed.")
      : undefined;
  const pendingScheduleId = toggle.isPending
    ? toggle.variables.data.scheduleId
    : remove.isPending
      ? remove.variables.data.scheduleId
      : undefined;

  return (
    <DiscoverySchedulesView
      actionError={actionError}
      createError={
        create.isError
          ? userFacingErrorMessage(create.error, "The target could not be added.")
          : undefined
      }
      errorMessage={
        schedules.isError
          ? userFacingErrorMessage(schedules.error, "Schedules could not load.")
          : undefined
      }
      formResetKey={formResetKey}
      isCreating={create.isPending}
      isLoading={schedules.isPending}
      issueAreas={issueAreas}
      onCreate={(schedule) => {
        create.reset();
        create.mutate({ data: schedule });
      }}
      onDelete={(schedule) => {
        void confirm({
          body: "Atlas will stop researching it every night. Profiles it already found stay in the catalog.",
          confirmLabel: "Remove",
          destructive: true,
          title: `Remove ${schedule.locationQuery}, ${schedule.state}?`,
        }).then((confirmed) => {
          if (!confirmed) return;
          // Only the latest action's outcome is shown, never a stale one.
          toggle.reset();
          remove.reset();
          remove.mutate({ data: { scheduleId: schedule.id } });
        });
      }}
      onToggle={(schedule) => {
        remove.reset();
        toggle.reset();
        toggle.mutate({ data: { enabled: !schedule.enabled, scheduleId: schedule.id } });
      }}
      pendingScheduleId={pendingScheduleId}
      schedules={schedules.data ?? []}
    />
  );
}
