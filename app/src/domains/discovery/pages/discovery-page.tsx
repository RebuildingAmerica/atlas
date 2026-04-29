import { useMemo, useState } from "react";
import { useAtlasSession } from "@/domains/access";
import { hasSerializedCapability } from "@/domains/access/capabilities";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { useDiscoveryRuns, useStartDiscovery } from "@/domains/discovery/hooks/use-discovery";
import {
  DiscoveryHero,
  DiscoverySetupNotice,
  DiscoveryUpgradePrompt,
} from "./components/discovery-hero";
import { DiscoveryRunForm } from "./components/discovery-run-form";
import { DiscoveryRunsPanel } from "./components/discovery-runs-panel";

/**
 * Renders the workspace discovery surface — a hero band, optional setup
 * and upgrade notices, the run-creation form, and the recent-runs panel.
 */
export function DiscoveryPage() {
  const atlasSession = useAtlasSession();
  const runsQuery = useDiscoveryRuns();
  const startDiscovery = useStartDiscovery();
  const taxonomyQuery = useTaxonomy();

  const [locationQuery, setLocationQuery] = useState("");
  const [state, setState] = useState("");
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);

  const issueAreas = useMemo(() => {
    const taxonomy = taxonomyQuery.data ?? {};
    return Object.entries(taxonomy)
      .flatMap(([, issues]) => issues)
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [taxonomyQuery.data]);

  const isLocal = atlasSession.data?.isLocal ?? false;
  const activeWorkspace = atlasSession.data?.workspace.activeOrganization ?? null;
  const canUseTeamFeatures = atlasSession.data?.workspace.capabilities.canUseTeamFeatures ?? false;
  const needsWorkspace = atlasSession.data?.workspace.onboarding.needsWorkspace ?? false;
  const canRunResearch = atlasSession.data
    ? hasSerializedCapability(atlasSession.data.workspace.resolvedCapabilities, "research.run")
    : false;
  const hasPendingInvitations =
    atlasSession.data?.workspace.onboarding.hasPendingInvitations ?? false;
  const activeProducts = atlasSession.data?.workspace.activeProducts ?? [];
  const isFreeTier = activeProducts.length === 0;
  const latestRuns = runsQuery.data?.items ?? [];

  const handleToggleIssue = (slug: string) => {
    setSelectedIssues((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  };

  const handleStateChange = (value: string) => {
    setState(value.toUpperCase().slice(0, 2));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!locationQuery.trim() || state.trim().length !== 2 || selectedIssues.length === 0) {
      return;
    }

    startDiscovery.mutate(
      {
        issue_areas: selectedIssues,
        location_query: locationQuery.trim(),
        state: state.trim().toUpperCase(),
      },
      {
        onSuccess: () => {
          setLocationQuery("");
          setState("");
          setSelectedIssues([]);
        },
      },
    );
  };

  const heroEyebrow = canUseTeamFeatures ? "Team discovery" : "Discovery";
  const heroTitle =
    canUseTeamFeatures && activeWorkspace ? `${activeWorkspace.name} discovery` : "Discovery";
  const heroDescription = needsWorkspace
    ? "Create a workspace to keep your discovery runs organized."
    : canUseTeamFeatures && activeWorkspace
      ? `Start runs for ${activeWorkspace.name} and keep the team aligned on what Atlas is actively researching.`
      : "Start discovery runs and check recent run status in one place.";
  const workspaceBadge = activeWorkspace && !isLocal ? activeWorkspace.name : null;

  return (
    <div className="space-y-10">
      <DiscoveryHero
        description={heroDescription}
        eyebrow={heroEyebrow}
        title={heroTitle}
        workspaceBadge={workspaceBadge}
      />

      {needsWorkspace ? (
        <DiscoverySetupNotice
          title="Create your workspace"
          body="Set up a workspace to organize your discovery runs and research."
          cta="Create a workspace"
        />
      ) : null}

      {hasPendingInvitations ? (
        <DiscoverySetupNotice
          title="You have workspace invitations waiting"
          body="Review your pending workspace invitations."
          cta="Review invitations"
        />
      ) : null}

      {!isLocal && !needsWorkspace && atlasSession.data && !canRunResearch ? (
        <DiscoveryUpgradePrompt reason="capability-missing" />
      ) : !isLocal && !needsWorkspace && atlasSession.data && isFreeTier ? (
        <DiscoveryUpgradePrompt reason="free-tier" />
      ) : null}

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <DiscoveryRunForm
          canRunResearch={canRunResearch}
          issueAreas={issueAreas}
          isPending={startDiscovery.isPending}
          isTaxonomyLoading={taxonomyQuery.isLoading}
          locationQuery={locationQuery}
          selectedIssues={selectedIssues}
          startError={Boolean(startDiscovery.error)}
          state={state}
          onLocationChange={setLocationQuery}
          onStateChange={handleStateChange}
          onSubmit={handleSubmit}
          onToggleIssue={handleToggleIssue}
        />
        <DiscoveryRunsPanel isLoading={runsQuery.isLoading} runs={latestRuns} />
      </section>
    </div>
  );
}
