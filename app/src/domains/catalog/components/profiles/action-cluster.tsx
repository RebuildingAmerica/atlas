/**
 * ActionCluster — primary CTAs in the profile hero.
 *
 * Phase 1 ships Share (real, with Web Share + clipboard) and Contact (mailto
 * when an email is on file). Save and Follow ship in Phase 3 alongside saved
 * lists and notifications.
 */
import { Mail, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/platform/ui/button";
import { cn } from "@/lib/utils";

interface ActionClusterProps {
  shareUrl: string;
  shareTitle: string;
  email?: string;
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
  "type-label-large inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 py-2.5 font-medium text-on-surface transition-colors duration-150 hover:border-outline hover:bg-surface-container-high focus:outline-none focus:ring-2 focus:ring-border-strong focus:ring-offset-2";

export function ActionCluster({ shareUrl, shareTitle, email }: ActionClusterProps) {
  const [shareState, setShareState] = useState<ShareState>("idle");

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

  const shareLabel =
    shareState === "copied" ? "Link copied" : shareState === "shared" ? "Shared" : "Share";

  function onShareClick() {
    void handleShare();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="primary" size="sm" onClick={onShareClick}>
        <span className="inline-flex items-center gap-2">
          <Share2 className="h-4 w-4" aria-hidden />
          {shareLabel}
        </span>
      </Button>

      {email ? (
        <a href={`mailto:${email}`} className={cn(SECONDARY_LINK_STYLE, "py-1.5")}>
          <Mail className="h-4 w-4" aria-hidden />
          Contact
        </a>
      ) : null}
    </div>
  );
}
