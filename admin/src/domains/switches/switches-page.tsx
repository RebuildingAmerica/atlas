import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useConfirmDialog } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { errorMessage } from "@/platform/error-message";
import { flipSwitch, loadSwitches } from "./switches.functions";
import { SwitchesView, type SwitchChange } from "./switches-view";

const SWITCHES_KEY = ["platform", "switches"] as const;

export function SwitchesPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  const switches = useQuery({
    queryKey: SWITCHES_KEY,
    queryFn: () => loadSwitches(),
  });
  const change = useMutation({
    mutationFn: (next: SwitchChange) => flipSwitch({ data: next }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SWITCHES_KEY }),
  });

  return (
    <SwitchesView
      changeMessage={
        change.isError
          ? errorMessage(change.error, "The switch could not be changed.")
          : undefined
      }
      errorMessage={
        switches.isError
          ? errorMessage(switches.error, "Switches could not load.")
          : undefined
      }
      isLoading={switches.isPending}
      onChange={(next) => {
        void confirm({
          body: next.engaged
            ? "It takes effect within a minute, everywhere."
            : "Normal operation resumes within a minute.",
          confirmLabel: next.engaged ? "Engage" : "Release",
          destructive: next.engaged,
          title: next.engaged ? "Engage this switch?" : "Release this switch?",
        }).then((confirmed) => {
          if (!confirmed) return;
          change.reset();
          change.mutate(next);
        });
      }}
      pendingName={change.isPending ? change.variables.name : undefined}
      switches={switches.data?.items ?? []}
    />
  );
}
