import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useConfirmDialog } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { listMerges, mergeProfiles, previewMerge } from "./merges.functions";
import { MergesView } from "./merges-view";

const MERGES_QUERY_KEY = ["editorial", "merges"] as const;

export function MergesPage() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const { confirm } = useConfirmDialog();
  const [formResetKey, setFormResetKey] = useState(0);
  const merges = useQuery({
    enabled: hydrated,
    queryFn: () => listMerges(),
    queryKey: MERGES_QUERY_KEY,
  });
  const preview = useMutation({ mutationFn: previewMerge });
  const merge = useMutation({
    mutationFn: mergeProfiles,
    onSuccess: async () => {
      preview.reset();
      setFormResetKey((key) => key + 1);
      await queryClient.invalidateQueries({ queryKey: MERGES_QUERY_KEY });
    },
  });

  return (
    <MergesView
      errorMessage={
        merges.isError
          ? userFacingErrorMessage(merges.error, "Past merges could not load.")
          : undefined
      }
      formResetKey={formResetKey}
      isLoading={merges.isPending}
      isMerging={merge.isPending}
      isPreviewing={preview.isPending}
      mergeError={
        merge.isError
          ? userFacingErrorMessage(merge.error, "The profiles could not be merged.")
          : undefined
      }
      merges={merges.data ?? []}
      onMerge={(checked, reason) => {
        void confirm({
          body: `${checked.duplicate.name}'s address will open ${checked.keep.name}, and the duplicate is retired. A merge cannot be undone.`,
          confirmLabel: "Merge",
          destructive: true,
          title: `Merge ${checked.duplicate.name} into ${checked.keep.name}?`,
        }).then((confirmed) => {
          if (!confirmed) return;
          merge.reset();
          merge.mutate({
            data: { duplicate: checked.duplicate.slug, keep: checked.keep.slug, reason },
          });
        });
      }}
      onPairChange={() => {
        preview.reset();
        merge.reset();
      }}
      onPreview={(pair) => {
        merge.reset();
        preview.mutate({ data: pair });
      }}
      preview={preview.data}
      previewError={
        preview.isError
          ? userFacingErrorMessage(preview.error, "That merge could not be checked.")
          : undefined
      }
    />
  );
}
