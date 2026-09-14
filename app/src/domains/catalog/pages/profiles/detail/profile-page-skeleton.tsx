import { cn } from "@/lib/utils";

/**
 * Which profile frame the placeholder stands in for. People and organizations
 * share the editorial actor layout; initiatives, campaigns and events render
 * the narrower record card.
 */
export type ProfileSkeletonLayout = "actor" | "record";

interface ProfilePageSkeletonProps {
  layout: ProfileSkeletonLayout;
}

interface SkeletonBlockProps {
  className?: string;
}

const SECTION_PLACEHOLDER_KEYS = ["history", "work", "network"] as const;
const STAT_PLACEHOLDER_KEYS = ["coverage", "issues", "tracked", "confirmed"] as const;

/** One pulsing bar, sized by the caller to match the text or media it replaces. */
export function SkeletonBlock({ className }: SkeletonBlockProps) {
  return <div aria-hidden className={cn("bg-surface-container-high animate-pulse", className)} />;
}

function ActorProfileSkeleton() {
  return (
    <div className="bg-page-bg pb-12">
      <div className="mx-auto max-w-[60rem] space-y-3 px-4 py-6 sm:px-6">
        <div className="border-border-taupe bg-surface-container-lowest border px-6 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
            <SkeletonBlock className="h-20 w-20 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-3">
              <SkeletonBlock className="h-9 w-2/3 rounded-md" />
              <SkeletonBlock className="h-5 w-1/2 rounded-md" />
              <SkeletonBlock className="h-4 w-1/3 rounded-md" />
            </div>
          </div>
        </div>

        <div className="border-border-taupe bg-surface-container-lowest space-y-3 border px-6 py-5 sm:px-8">
          <SkeletonBlock className="h-3 w-32 rounded-sm" />
          <SkeletonBlock className="h-4 w-full rounded-sm" />
          <SkeletonBlock className="h-4 w-5/6 rounded-sm" />
        </div>

        <div className="border-border-taupe border-t-ink-strong bg-surface-container-lowest grid grid-cols-2 border border-t-[2px] sm:grid-cols-4">
          {STAT_PLACEHOLDER_KEYS.map((key) => (
            <div key={key} className="space-y-2 px-5 py-4">
              <SkeletonBlock className="h-7 w-12 rounded-sm" />
              <SkeletonBlock className="h-3 w-20 rounded-sm" />
            </div>
          ))}
        </div>

        {SECTION_PLACEHOLDER_KEYS.map((key) => (
          <div
            key={key}
            className="border-border-taupe bg-surface-container-lowest space-y-3 border-t px-6 py-6 sm:px-8"
          >
            <SkeletonBlock className="h-3 w-40 rounded-sm" />
            <SkeletonBlock className="h-16 w-full rounded-[0.875rem]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordProfileSkeleton() {
  return (
    <div className="bg-page-bg px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="border-border bg-surface-container-lowest space-y-4 rounded-3xl border p-6">
          <SkeletonBlock className="h-6 w-28 rounded-full" />
          <SkeletonBlock className="h-9 w-2/3 rounded-md" />
          <SkeletonBlock className="h-4 w-full rounded-sm" />
          <SkeletonBlock className="h-4 w-4/5 rounded-sm" />
        </div>
        <SkeletonBlock className="h-48 w-full rounded-3xl" />
      </div>
    </div>
  );
}

/**
 * The profile page's own frame with every data-bearing part held as a
 * placeholder.
 *
 * A visitor who opens a profile while the API is failing sees the page they
 * asked for taking shape rather than an error, and the real profile replaces
 * it in place once the browser's retry succeeds.
 */
export function ProfilePageSkeleton({ layout }: ProfilePageSkeletonProps) {
  return (
    <div aria-busy="true" data-testid="profile-page-skeleton" data-layout={layout}>
      <span role="status" className="sr-only">
        Loading profile
      </span>
      {layout === "actor" ? <ActorProfileSkeleton /> : <RecordProfileSkeleton />}
    </div>
  );
}
