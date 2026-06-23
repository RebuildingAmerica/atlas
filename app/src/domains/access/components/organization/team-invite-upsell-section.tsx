import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

/**
 * Upsell shown on a team workspace that has no active Atlas Team subscription,
 * where inviting members is gated behind billing.
 *
 * Replaces the invitations form so the operator understands why they cannot
 * invite yet and where to subscribe, rather than seeing nothing at all.
 */
export function TeamInviteUpsellSection() {
  return (
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Invitations</h2>
        <p className="type-body-medium text-ink-soft">
          Subscribe to Atlas Team to invite members to this workspace.
        </p>
      </div>

      <Link
        to="/pricing"
        className="type-label-large text-ink-strong hover:bg-surface-container-high border-border focus:ring-border-strong inline-flex items-center gap-2 rounded-full border bg-transparent px-4 py-2 font-medium no-underline transition-[background-color,border-color] duration-150 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      >
        <Sparkles className="h-4 w-4" />
        Subscribe to Atlas Team
      </Link>
    </article>
  );
}
