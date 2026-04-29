import { useEffect, useMemo, useRef, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/platform/ui/toast";
import { Button } from "@/platform/ui/button";

/**
 * Builds the deep link an admin can paste in chat or email to invite their
 * IT team to take over SSO setup.  The path resolves to the same focused
 * SSO surface the admin sees today, so the recipient lands directly on the
 * configuration form once they've signed in to the workspace.
 *
 * Atlas does not mint a single-use token here — the workspace's existing
 * domain verification and access-control checks gate who can actually save
 * a provider once they reach the page.
 */
export function buildIdTeamShareUrl(publicBaseUrl: string, workspaceSlug: string): string {
  const url = new URL("/organization/sso", publicBaseUrl);
  url.searchParams.set("from", workspaceSlug);
  return url.toString();
}

interface SsoShareLinkButtonProps {
  workspaceSlug: string;
}

export function SsoShareLinkButton({ workspaceSlug }: SsoShareLinkButtonProps) {
  const toast = useToast();
  const [copying, setCopying] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const shareUrl = useMemo(() => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return buildIdTeamShareUrl(origin, workspaceSlug);
  }, [workspaceSlug]);

  async function handleCopy() {
    setCopying(true);
    try {
      const ok = await copyToClipboard(shareUrl);
      if (!mountedRef.current) return;
      if (ok) {
        toast.success("SSO setup link copied — paste it for your IT team.");
      } else {
        toast.error("Atlas couldn't copy the link.  Select and copy by hand.");
      }
    } finally {
      if (mountedRef.current) setCopying(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={copying}
      onClick={() => {
        void handleCopy();
      }}
    >
      {copying ? "Copying..." : "Send to my IT team"}
    </Button>
  );
}
