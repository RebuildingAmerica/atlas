/**
 * ActionCluster — bottom-of-page action strip for profile pages.
 *
 * Square buttons on an inverse ink-black band. Save / Share / Contact / Follow
 * — labels only, no decorative icons. Save and Follow are auth-aware: anonymous
 * visitors get sign-in links with a redirect; signed-in visitors get the real
 * list-picker and follow toggle.
 */
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import {
  useFollowProfile,
  useProfileFollow,
  useUnfollowProfile,
} from "@/domains/catalog/hooks/use-claims";
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

const SOLID_BUTTON =
  "inline-flex min-h-[44px] items-center justify-center border border-paper bg-paper px-5 py-2.5 font-sans text-sm font-semibold text-ink-strong transition-colors hover:border-civic hover:bg-civic hover:text-paper disabled:cursor-not-allowed disabled:opacity-60";

const GHOST_BUTTON =
  "inline-flex min-h-[44px] items-center justify-center border border-paper bg-transparent px-5 py-2.5 font-sans text-sm font-semibold text-paper transition-colors hover:border-civic hover:bg-civic disabled:cursor-not-allowed disabled:opacity-60";

export function ActionCluster({
  entryId,
  entrySlug,
  shareUrl,
  shareTitle,
  email,
  isSignedIn,
  profilePath,
}: ActionClusterProps) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [savePickerOpen, setSavePickerOpen] = useState(false);
  const followQuery = useProfileFollow(entrySlug, isSignedIn);
  const followMutation = useFollowProfile();
  const unfollowMutation = useUnfollowProfile();
  const isFollowing = Boolean(followQuery.data);

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

  const shareLabel =
    shareState === "copied" ? "Link copied" : shareState === "shared" ? "Shared" : "Share";

  return (
    <nav
      aria-label="Profile actions"
      className="border-border-taupe bg-ink-strong flex flex-wrap items-center gap-2.5 border px-6 py-4 sm:px-8"
    >
      {isSignedIn ? (
        <div className="relative">
          <button type="button" className={SOLID_BUTTON} onClick={onSaveClick}>
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
        <Link to="/sign-in" search={{ redirect: profilePath }} className={SOLID_BUTTON}>
          Save
        </Link>
      )}

      <button type="button" className={GHOST_BUTTON} onClick={onShareClick}>
        {shareLabel}
      </button>

      {email ? (
        <a href={`mailto:${email}`} className={GHOST_BUTTON}>
          Contact
        </a>
      ) : null}

      {isSignedIn ? (
        <button
          type="button"
          className={cn(GHOST_BUTTON, isFollowing && "border-civic bg-civic")}
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
