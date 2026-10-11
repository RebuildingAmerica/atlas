import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useConfirmDialog } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { createTakedown, listTakedowns, restoreTakedown } from "./takedowns.functions";
import { TakedownsView } from "./takedowns-view";

const TAKEDOWNS_QUERY_KEY = ["editorial", "takedowns"] as const;

export function TakedownsPage() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  const [formResetKey, setFormResetKey] = useState(0);
  const takedowns = useQuery({
    enabled: hydrated,
    queryFn: () => listTakedowns(),
    queryKey: TAKEDOWNS_QUERY_KEY,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: TAKEDOWNS_QUERY_KEY });
  const create = useMutation({
    mutationFn: createTakedown,
    onSuccess: async () => {
      setFormResetKey((key) => key + 1);
      await refresh();
    },
  });
  const restore = useMutation({ mutationFn: restoreTakedown, onSuccess: refresh });

  return (
    <TakedownsView
      actionError={
        restore.isError
          ? userFacingErrorMessage(restore.error, "The profile could not be restored.")
          : undefined
      }
      createError={
        create.isError
          ? userFacingErrorMessage(create.error, "The profile could not be taken down.")
          : undefined
      }
      errorMessage={
        takedowns.isError
          ? userFacingErrorMessage(takedowns.error, "Takedowns could not load.")
          : undefined
      }
      formResetKey={formResetKey}
      isCreating={create.isPending}
      isLoading={takedowns.isPending}
      onCreate={(takedown) => {
        void confirm({
          body: "It disappears from Atlas, including search and connections, and stays hidden until an editor restores it.",
          confirmLabel: "Take down",
          destructive: true,
          title: "Take this profile down?",
        }).then((confirmed) => {
          if (!confirmed) return;
          create.reset();
          create.mutate({ data: takedown });
        });
      }}
      onRestore={(takedown) => {
        void confirm({
          body: takedown.wasPublished
            ? "It will be public on Atlas again."
            : "It goes back to waiting for editorial review.",
          confirmLabel: "Restore",
          title: `Restore ${takedown.entryName}?`,
        }).then((confirmed) => {
          if (!confirmed) return;
          restore.reset();
          restore.mutate({ data: { takedownId: takedown.id } });
        });
      }}
      pendingTakedownId={restore.isPending ? restore.variables.data.takedownId : undefined}
      takedowns={takedowns.data ?? []}
    />
  );
}
