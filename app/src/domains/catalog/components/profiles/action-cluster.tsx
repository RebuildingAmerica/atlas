/**
 * ActionCluster — primary CTAs in the profile hero.
 *
 * Renders Share (real, with Web Share + clipboard fallback), Contact (mailto
 * when an email is on file), Save, and Follow. Save and Follow are
 * auth-state-aware: anonymous visitors are routed to sign-in with a redirect
 * back to the profile; signed-in visitors get an inline disclosure noting the
 * underlying feature is still being built.
 */
import { Link } from "@tanstack/react-router";
import { Bell, Bookmark, Mail, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/platform/ui/button";
import { cn } from "@/lib/utils";

interface ActionClusterProps {
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

const DISCLOSURE_PILL_STYLE =
  "type-label-small text-ink-soft inline-flex items-center gap-1 rounded-full bg-surface-container-low px-2.5 py-0.5";

export function ActionCluster({
  shareUrl,
  shareTitle,
  email,
  isSignedIn,
  profilePath,
}: ActionClusterProps) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [saveDisclosed, setSaveDisclosed] = useState(false);
  const [followDisclosed, setFollowDisclosed] = useState(false);

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

  function discloseSave() {
    setSaveDisclosed(true);
    window.setTimeout(() => {
      setSaveDisclosed(false);
    }, 3_000);
  }

  function discloseFollow() {
    setFollowDisclosed(true);
    window.setTimeout(() => {
      setFollowDisclosed(false);
    }, 3_000);
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
          <Button type="button" variant="secondary" size="sm" onClick={discloseSave}>
            <span className="inline-flex items-center gap-2">
              <Bookmark className="h-4 w-4" aria-hidden />
              Save
            </span>
          </Button>
        ) : (
          <Link to="/sign-in" search={{ redirect: profilePath }} className={SECONDARY_LINK_STYLE}>
            <Bookmark className="h-4 w-4" aria-hidden />
            Save
          </Link>
        )}

        {isSignedIn ? (
          <Button type="button" variant="secondary" size="sm" onClick={discloseFollow}>
            <span className="inline-flex items-center gap-2">
              <Bell className="h-4 w-4" aria-hidden />
              Follow
            </span>
          </Button>
        ) : (
          <Link to="/sign-in" search={{ redirect: profilePath }} className={SECONDARY_LINK_STYLE}>
            <Bell className="h-4 w-4" aria-hidden />
            Follow
          </Link>
        )}
      </div>

      {saveDisclosed || followDisclosed ? (
        <div className="flex flex-wrap justify-end gap-2">
          {saveDisclosed ? (
            <span className={cn(DISCLOSURE_PILL_STYLE)} role="status">
              Lists are still being built — we’ll email you when Save is live.
            </span>
          ) : null}
          {followDisclosed ? (
            <span className={cn(DISCLOSURE_PILL_STYLE)} role="status">
              Update notifications are still being built.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
