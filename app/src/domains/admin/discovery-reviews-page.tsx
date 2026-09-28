import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { useTaxonomy } from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { AdminInlineStatus } from "./admin-portal";
import {
  decideDiscoveryReview,
  listDiscoveryReviews,
  prepareLasVegasWebsiteReviews,
  stageEditorialCandidate,
} from "./discovery-reviews.functions";
import { DiscoveryReviewsView } from "./discovery-reviews-view";
import { EditorialCandidateForm } from "./editorial-candidate-form";

const PAGE_SIZE = 25;

export function DiscoveryReviewsPage() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const taxonomy = useTaxonomy();
  const [offset, setOffset] = useState(0);
  const [prepareMessage, setPrepareMessage] = useState<string>();
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeMessage, setIntakeMessage] = useState<string>();
  const issueAreas = useMemo(
    () =>
      Object.values(taxonomy.data ?? {})
        .flat()
        .sort((left, right) => left.name.localeCompare(right.name)),
    [taxonomy.data],
  );
  const reviews = useQuery({
    enabled: hydrated,
    queryFn: () => listDiscoveryReviews({ data: { offset } }),
    queryKey: ["admin", "discovery-reviews", offset],
  });
  const decision = useMutation({
    mutationFn: decideDiscoveryReview,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "discovery-reviews"] });
    },
  });
  const prepare = useMutation({
    mutationFn: prepareLasVegasWebsiteReviews,
    onSuccess: ({ enqueued }) => {
      setPrepareMessage(
        enqueued === 0
          ? "No new website proposals."
          : `${enqueued} website proposal${enqueued === 1 ? "" : "s"} ready for review.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "discovery-reviews"] });
    },
  });
  const intake = useMutation({
    mutationFn: stageEditorialCandidate,
    onSuccess: () => {
      setIntakeOpen(false);
      setIntakeMessage("Organization ready for editorial review. Its profile is not public.");
      setOffset(0);
      void queryClient.invalidateQueries({ queryKey: ["admin", "discovery-reviews"] });
    },
  });

  return (
    <DiscoveryReviewsView
      decisionError={
        decision.isError
          ? userFacingErrorMessage(
              decision.error,
              "Decision could not be saved. Reload and review the current facts.",
            )
          : undefined
      }
      editorialIntake={
        <section className="space-y-3" aria-label="Editorial organization intake">
          {!intakeOpen ? (
            <Button
              onClick={() => {
                setIntakeMessage(undefined);
                intake.reset();
                setIntakeOpen(true);
              }}
              size="sm"
              variant="secondary"
            >
              Add organization from official source
            </Button>
          ) : (
            <EditorialCandidateForm
              error={
                intake.isError
                  ? userFacingErrorMessage(
                      intake.error,
                      "Organization could not be queued. Check for an existing profile or try again.",
                    )
                  : undefined
              }
              issueAreas={issueAreas}
              onSubmit={(candidate) => {
                intake.reset();
                intake.mutate({ data: candidate });
              }}
              pending={intake.isPending}
            />
          )}
          <AdminInlineStatus message={intakeMessage} />
        </section>
      }
      errorMessage={
        reviews.isError
          ? userFacingErrorMessage(reviews.error, "Discovery reviews could not load.")
          : undefined
      }
      items={reviews.data?.items ?? []}
      isLoading={reviews.isPending}
      onDecision={(itemId, selectedDecision) => {
        decision.reset();
        decision.mutate({ data: { decision: selectedDecision, itemId } });
      }}
      onPageChange={setOffset}
      onPrepareWebsiteReviews={() => {
        setPrepareMessage(undefined);
        prepare.reset();
        prepare.mutate(undefined);
      }}
      offset={offset}
      pendingItemId={decision.isPending ? decision.variables.data.itemId : undefined}
      prepareError={
        prepare.isError
          ? userFacingErrorMessage(prepare.error, "Website candidates could not be prepared.")
          : undefined
      }
      prepareMessage={prepareMessage}
      preparing={prepare.isPending}
      total={reviews.data?.total ?? 0}
      pageSize={PAGE_SIZE}
    />
  );
}
