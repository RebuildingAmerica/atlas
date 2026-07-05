/**
 * ActionCluster — bottom-of-page action strip for profile pages.
 *
 * Square buttons on a warm surface-container band so the strip reads as part of
 * the profile card stack rather than detached chrome. Sources / Share /
 * Contact / Save / Follow. Save and Follow are auth-aware:
 * anonymous visitors get sign-in links with a redirect; signed-in visitors get
 * the real list-picker and follow toggle.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import {
  useFollowProfile,
  useProfileFollow,
  useUnfollowProfile,
} from "@/domains/catalog/hooks/use-claims";
import {
  useUnwatchWorkspaceResource,
  useWatchWorkspaceResource,
  useWorkspaceWatchStatus,
} from "@/domains/workspace/hooks/use-workspace-watches";
import { SaveListPicker } from "@/domains/catalog/components/profiles/save-list-picker";
import { cn } from "@/lib/utils";

interface ActionClusterProps {
  entryId: string;
  entrySlug: string;
  shareUrl: string;
  shareTitle: string;
  email?: string;
  isSignedIn: boolean;
  profilePath: string;
  sourcesHref?: string;
  workspaceId?: string | null;
  workspaceWatchingEnabled?: boolean;
}

type ShareState = "idle" | "copied" | "shared";

async function shareViaWebApi(url: string, title: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !("share" in navigator)) {
    return false;
  }
  try {
    await navigator.share({ url, title });
    return true;
  } catch {
    return false;
  }
}

const FOCUS_RING =
  "focus-visible:ring-civic focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container focus-visible:outline-none";

const SOLID_BUTTON =
  "inline-flex min-h-[44px] items-center justify-center border border-civic bg-civic px-5 py-2.5 font-sans text-sm font-semibold text-paper transition-colors hover:border-civic-deep hover:bg-civic-deep disabled:cursor-not-allowed disabled:opacity-60 " +
  FOCUS_RING;

const GHOST_BUTTON =
  "inline-flex min-h-[44px] items-center justify-center border border-border-taupe bg-surface-container-lowest px-5 py-2.5 font-sans text-sm font-semibold text-ink-strong transition-colors hover:border-civic hover:text-civic disabled:cursor-not-allowed disabled:opacity-60 " +
  FOCUS_RING;

export function ActionCluster({
  entryId,
  entrySlug,
  shareUrl,
  shareTitle,
  email,
  isSignedIn,
  profilePath,
  sourcesHref,
  workspaceId = null,
  workspaceWatchingEnabled = false,
}: ActionClusterProps) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [savePickerOpen, setSavePickerOpen] = useState(false);
  const followQuery = useProfileFollow(entrySlug, isSignedIn);
  const followMutation = useFollowProfile();
  const unfollowMutation = useUnfollowProfile();
  const workspaceWatchInput = {
    resourceId: entryId,
    resourceType: "entry" as const,
  };
  const workspaceWatchQuery = useWorkspaceWatchStatus(
    workspaceWatchInput,
    isSignedIn && workspaceWatchingEnabled,
    workspaceId,
  );
  const watchWorkspaceMutation = useWatchWorkspaceResource();
  const unwatchWorkspaceMutation = useUnwatchWorkspaceResource();
  const isFollowing = Boolean(followQuery.data);
  const isWorkspaceWatched = Boolean(workspaceWatchQuery.data?.watched);

  async function handleShare() {
    const shared = await shareViaWebApi(shareUrl, shareTitle);
    if (shared) {
      setShareState("shared");
      window.setTimeout(() => {
        setShareState("idle");
      }, 2_000);
      return;
    }
    const copied = await copyToClipboard(shareUrl);
    if (copied) {
      setShareState("copied");
      window.setTimeout(() => {
        setShareState("idle");
      }, 2_000);
    }
  }

  function onShareClick() {
    void handleShare();
  }

  function onSaveClick() {
    setSavePickerOpen((current) => !current);
  }

  async function onFollowClick() {
    if (isFollowing) {
      await unfollowMutation.mutateAsync(entrySlug);
    } else {
      await followMutation.mutateAsync(entrySlug);
    }
  }

  function onFollowClickWrapper() {
    void onFollowClick();
  }

  async function onWorkspaceWatchClick() {
    if (isWorkspaceWatched) {
      await unwatchWorkspaceMutation.mutateAsync(workspaceWatchInput);
    } else {
      await watchWorkspaceMutation.mutateAsync({
        ...workspaceWatchInput,
        notificationPreference: "digest",
      });
    }
  }

  function onWorkspaceWatchClickWrapper() {
    void onWorkspaceWatchClick();
  }

  const shareLabel =
    shareState === "copied" ? "Link copied" : shareState === "shared" ? "Shared" : "Share";
  const workspaceWatchDisabled =
    workspaceWatchQuery.isLoading ||
    watchWorkspaceMutation.isPending ||
    unwatchWorkspaceMutation.isPending;

  return (
    <nav
      aria-label="Profile actions"
      className="border-border-taupe bg-surface-container flex flex-wrap items-center gap-2.5 border px-6 py-5 sm:px-8"
    >
      {sourcesHref ? (
        <a href={sourcesHref} className={SOLID_BUTTON}>
          Inspect sources
        </a>
      ) : null}

      <button type="button" className={GHOST_BUTTON} onClick={onShareClick}>
        {shareLabel}
      </button>

      {email ? (
        <a href={`mailto:${email}`} className={GHOST_BUTTON}>
          Contact
        </a>
      ) : null}

      {isSignedIn ? (
        <div className="relative">
          <button type="button" className={GHOST_BUTTON} onClick={onSaveClick}>
            Save
          </button>
          <SaveListPicker
            entryId={entryId}
            open={savePickerOpen}
            onClose={() => {
              setSavePickerOpen(false);
            }}
          />
        </div>
      ) : (
        <Link to="/sign-in" search={{ redirect: profilePath }} className={GHOST_BUTTON}>
          Save
        </Link>
      )}

      {isSignedIn && workspaceWatchingEnabled ? (
        <button
          type="button"
          className={cn(
            GHOST_BUTTON,
            isWorkspaceWatched && "border-civic bg-civic text-paper hover:text-paper",
          )}
          onClick={onWorkspaceWatchClickWrapper}
          disabled={workspaceWatchDisabled}
        >
          {isWorkspaceWatched ? "Watching" : "Watch"}
        </button>
      ) : null}

      {isSignedIn ? (
        <button
          type="button"
          className={cn(
            GHOST_BUTTON,
            isFollowing && "border-civic bg-civic text-paper hover:text-paper",
          )}
          onClick={onFollowClickWrapper}
          disabled={followMutation.isPending || unfollowMutation.isPending}
        >
          {isFollowing ? "Following" : "Follow updates"}
        </button>
      ) : (
        <Link to="/sign-in" search={{ redirect: profilePath }} className={GHOST_BUTTON}>
          Follow updates
        </Link>
      )}
    </nav>
  );
}
