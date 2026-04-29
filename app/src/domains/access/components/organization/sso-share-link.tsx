import { useState } from "react";
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
  const trimmedBase = publicBaseUrl.replace(/\/+$/, "");
  return `${trimmedBase}/organization/sso?from=${encodeURIComponent(workspaceSlug)}`;
}

interface SsoShareLinkButtonProps {
  workspaceSlug: string;
}

/**
 * One-click "Send to my IT team" button that copies a sharable deep link
 * to the SSO setup surface.  Makes it easy for a workspace owner to hand
 * off the SSO configuration without copying the URL by hand.  The button
 * derives the public origin from `window.location` since it only runs in
 * the browser.
 */
export function SsoShareLinkButton({ workspaceSlug }: SsoShareLinkButtonProps) {
  const toast = useToast();
  const [copying, setCopying] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = buildIdTeamShareUrl(origin, workspaceSlug);

  async function copy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("SSO setup link copied — paste it for your IT team.");
    } catch {
      toast.error("Atlas couldn't copy the link.  Select and copy by hand.");
    } finally {
      setCopying(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={copying}
      onClick={() => {
        void copy();
      }}
    >
      {copying ? "Copying..." : "Send to my IT team"}
    </Button>
  );
}
