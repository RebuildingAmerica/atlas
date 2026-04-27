/**
 * ActionCluster — primary CTAs in the profile hero.
 *
 * Renders Share (real, with Web Share + clipboard fallback), Contact (mailto
 * when an email is on file), Save (sign-in link for anonymous, list picker for
 * signed-in), and Follow (sign-in link for anonymous, real follow toggle for
 * signed-in).
 */
import { Link } from "@tanstack/react-router";
import { Bell, BellRing, Bookmark, Mail, Share2 } from "lucide-react";
import { useState } from "react";
import {
  useFollowProfile,
  useProfileFollow,
  useUnfollowProfile,
} from "@/domains/catalog/hooks/use-claims";
import { SaveListPicker } from "@/domains/catalog/components/profiles/save-list-picker";
import { Button } from "@/platform/ui/button";

interface ActionClusterProps {
  entryId: string;
  entrySlug: string;
  shareUrl: string;
  shareTitle: string;
  email?: string;
  /** Whether the current viewer has an active Atlas session. */
  isSignedIn: boolean;
  /**
   * Path of the profile being viewed, used as the `redirect` target if an
   * anonymous visitor clicks Save or Follow and is sent through sign-in.
   */
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

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const SECONDARY_LINK_STYLE =
  "type-label-large inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 py-1.5 font-medium text-on-surface transition-colors duration-150 hover:border-outline hover:bg-surface-container-high focus:outline-none focus:ring-2 focus:ring-border-strong focus:ring-offset-2";

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
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" size="sm" onClick={onShareClick}>
          <span className="inline-flex items-center gap-2">
            <Share2 className="h-4 w-4" aria-hidden />
            {shareLabel}
          </span>
        </Button>

        {email ? (
          <a href={`mailto:${email}`} className={SECONDARY_LINK_STYLE}>
            <Mail className="h-4 w-4" aria-hidden />
            Contact
          </a>
        ) : null}

        {isSignedIn ? (
          <div className="relative">
            <Button type="button" variant="secondary" size="sm" onClick={onSaveClick}>
              <span className="inline-flex items-center gap-2">
                <Bookmark className="h-4 w-4" aria-hidden />
                Save
              </span>
            </Button>
            <SaveListPicker
              entryId={entryId}
              open={savePickerOpen}
              onClose={() => {
                setSavePickerOpen(false);
              }}
            />
          </div>
        ) : (
          <Link to="/sign-in" search={{ redirect: profilePath }} className={SECONDARY_LINK_STYLE}>
            <Bookmark className="h-4 w-4" aria-hidden />
            Save
          </Link>
        )}

        {isSignedIn ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onFollowClickWrapper}
            disabled={followMutation.isPending || unfollowMutation.isPending}
          >
            <span className="inline-flex items-center gap-2">
              {isFollowing ? (
                <BellRing className="text-accent h-4 w-4" aria-hidden />
              ) : (
                <Bell className="h-4 w-4" aria-hidden />
              )}
              {isFollowing ? "Following" : "Follow"}
            </span>
          </Button>
        ) : (
          <Link to="/sign-in" search={{ redirect: profilePath }} className={SECONDARY_LINK_STYLE}>
            <Bell className="h-4 w-4" aria-hidden />
            Follow
          </Link>
        )}
      </div>
    </div>
  );
}
