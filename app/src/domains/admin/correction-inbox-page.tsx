import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { decideCorrectionReport, listCorrectionReports } from "./correction-inbox.functions";
import { CorrectionInboxView } from "./correction-inbox-view";

const PAGE_SIZE = 25;

export function CorrectionInboxPage() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const reports = useQuery({
    enabled: hydrated,
    queryFn: () => listCorrectionReports({ data: { offset } }),
    queryKey: ["admin", "correction-inbox", offset],
  });
  const decision = useMutation({
    mutationFn: decideCorrectionReport,
    onSuccess: () => {
      if (offset > 0 && reports.data?.items.length === 1) {
        setOffset(Math.max(0, offset - PAGE_SIZE));
      }
      void queryClient.invalidateQueries({ queryKey: ["admin", "correction-inbox"] });
    },
  });

  return (
    <CorrectionInboxView
      decisionError={
        decision.isError
          ? userFacingErrorMessage(decision.error, "Decision could not be saved.")
          : undefined
      }
      errorMessage={
        reports.isError
          ? userFacingErrorMessage(reports.error, "Visitor reports could not load.")
          : undefined
      }
      isLoading={reports.isPending}
      items={reports.data?.items ?? []}
      offset={offset}
      onDecision={(reportId, targetType, selectedDecision) => {
        decision.reset();
        decision.mutate({ data: { decision: selectedDecision, reportId, targetType } });
      }}
      onPageChange={setOffset}
      pageSize={PAGE_SIZE}
      pendingItemId={decision.isPending ? decision.variables.data.reportId : undefined}
      total={reports.data?.total ?? 0}
    />
  );
}
