import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { AdminInlineStatus } from "./admin-portal";
import {
  loadEditorialProfile,
  searchEditorialProfiles,
  stageEditorialProfileChange,
} from "./discovery-reviews.functions";
import { EditorialCandidateForm } from "./editorial-candidate-form";

interface EditorialProfileCorrectionProps {
  issueAreas: { name: string; slug: string }[];
  onQueued: () => void;
}

export function EditorialProfileCorrection({
  issueAreas,
  onQueued,
}: EditorialProfileCorrectionProps) {
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [queued, setQueued] = useState(false);
  const matches = useQuery({
    enabled: query.length >= 2,
    queryFn: () => searchEditorialProfiles({ data: { query } }),
    queryKey: ["admin", "editorial-profile-search", query],
  });
  const profile = useQuery({
    enabled: selectedId.length > 0,
    queryFn: () => loadEditorialProfile({ data: { entityId: selectedId } }),
    queryKey: ["admin", "editorial-profile", selectedId],
  });
  const stage = useMutation({
    mutationFn: stageEditorialProfileChange,
    onSuccess: () => {
      setQueued(true);
      setSelectedId("");
      onQueued();
    },
  });

  return (
    <section aria-label="Correct published organization" className="space-y-4">
      <div className="border-border bg-surface-container-lowest space-y-4 rounded-lg border p-5">
        <h2 className="type-title-large text-ink-strong">Find the existing profile</h2>
        <p className="type-body-small text-ink-soft">
          Check the existing organization before proposing a correction so the public keeps one
          profile.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input
              label="Find published organization"
              onChange={setSearchText}
              value={searchText}
            />
          </div>
          <Button
            disabled={searchText.trim().length < 2}
            onClick={() => {
              setQueued(false);
              setSelectedId("");
              setQuery(searchText.trim());
            }}
            size="sm"
            variant="secondary"
          >
            Find organization
          </Button>
        </div>
        <AdminInlineStatus
          message={
            matches.isError
              ? userFacingErrorMessage(matches.error, "Organization search could not load.")
              : undefined
          }
        />
        {matches.isFetching ? <p role="status">Searching organizations…</p> : null}
        {query && matches.data?.length === 0 ? (
          <p className="type-body-small text-ink-soft">
            No published organization matched. Check the name or try a shorter search.
          </p>
        ) : null}
        {matches.data && matches.data.length > 0 ? (
          <ul className="space-y-2">
            {matches.data.map((match) => (
              <li key={match.id}>
                <Button
                  onClick={() => {
                    setQueued(false);
                    setSelectedId(match.id);
                    stage.reset();
                  }}
                  size="sm"
                  variant="secondary"
                >
                  Select {match.name} ·{" "}
                  {[match.city, match.state].filter(Boolean).join(", ") || "Place unknown"}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {profile.isFetching ? <p role="status">Loading current profile…</p> : null}
      <AdminInlineStatus
        message={
          profile.isError
            ? userFacingErrorMessage(profile.error, "Current profile could not load.")
            : undefined
        }
      />
      {profile.data?.officialSources.length === 0 ? (
        <p className="type-body-small text-on-error-container">
          This profile has no linked official organization site. Add and review one before proposing
          a change.
        </p>
      ) : null}
      {profile.data && profile.data.officialSources.length > 0 ? (
        <div className="space-y-3">
          {profile.data.profileUrl ? (
            <a className="type-label-medium text-accent" href={profile.data.profileUrl}>
              Open current public profile
            </a>
          ) : null}
          <EditorialCandidateForm
            key={profile.data.id}
            error={
              stage.isError
                ? userFacingErrorMessage(
                    stage.error,
                    "Correction could not be queued. Reload the current profile and try again.",
                  )
                : undefined
            }
            heading="Improve existing organization"
            initial={profile.data.initial}
            issueAreas={issueAreas}
            onSubmit={(candidate) => {
              stage.reset();
              stage.mutate({ data: { entityId: profile.data.id, candidate } });
            }}
            pending={stage.isPending}
            submitLabel="Propose correction"
          />
        </div>
      ) : null}
      {queued ? (
        <p className="type-body-small text-ink-soft" role="status">
          Correction ready for editorial review. The public profile is unchanged until approval.
        </p>
      ) : null}
    </section>
  );
}
