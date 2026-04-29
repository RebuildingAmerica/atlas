import { Sparkles } from "lucide-react";
import type { Entry } from "@/types";
import { CompanionSpotlight, SectionHeading, SpotlightCard } from "./profile-showcase-primitives";

interface ProfilesMarqueeProps {
  entries: Entry[];
  error?: Error | null;
  isLoading?: boolean;
  issueAreaLabels: Record<string, string>;
}

/**
 * Spotlight band at the top of the profiles surface.  Renders a hero
 * SpotlightCard alongside up to two companion cards, plus loading and
 * error states that hold the same vertical rhythm.
 */
export function ProfilesMarquee({
  entries,
  error = null,
  isLoading = false,
  issueAreaLabels,
}: ProfilesMarqueeProps) {
  if (error) {
    return (
      <section className="space-y-4">
        <SectionHeading
          icon={<Sparkles className="h-4 w-4" />}
          subtitle="Spotlight"
          title="Featured profiles"
        />
        <p className="type-body-medium text-red-800">{error.message}</p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="space-y-6">
        <SectionHeading
          icon={<Sparkles className="h-4 w-4" />}
          subtitle="Spotlight"
          title="Featured profiles"
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)]">
          <div className="bg-surface-container h-[30rem] animate-pulse rounded-[1.25rem]" />
          <div className="grid gap-4">
            <div className="bg-surface-container-low h-[14.5rem] animate-pulse rounded-[1rem]" />
            <div className="bg-surface-container-low h-[14.5rem] animate-pulse rounded-[1rem]" />
          </div>
        </div>
      </section>
    );
  }

  if (entries.length === 0) {
    return null;
  }

  const primary = entries[0];
  const companions = entries.slice(1, 3);

  return (
    <section className="space-y-6">
      <SectionHeading
        icon={<Sparkles className="h-4 w-4" />}
        subtitle="Spotlight"
        title="Profiles worth opening"
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)]">
        {primary ? <SpotlightCard entry={primary} issueAreaLabels={issueAreaLabels} /> : null}

        <div className="grid gap-4">
          {companions.map((entry) => (
            <CompanionSpotlight key={entry.id} entry={entry} issueAreaLabels={issueAreaLabels} />
          ))}
        </div>
      </div>
    </section>
  );
}
