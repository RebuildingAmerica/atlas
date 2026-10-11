import { useState } from "react";
import {
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import {
  MEDIUM_DATE,
  useDateTimeFormatter,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import type {
  AccountLookupResponse,
  LookupWorkspace,
} from "@/generated/platform-schemas";

interface AccountsViewProps {
  errorMessage?: string;
  isSearching: boolean;
  onSearch: (query: string) => void;
  /** The last answer, or undefined before the first search. */
  result?: AccountLookupResponse;
}

interface WorkspaceCardProps {
  workspace: LookupWorkspace;
}

/**
 * Answers "what does this person have, and why?" without production SQL.
 * Read-only: nothing here changes an account.
 */
export function AccountsView({
  errorMessage,
  isSearching,
  onSearch,
  result,
}: AccountsViewProps) {
  const [query, setQuery] = useState("");
  const formatDate = useDateTimeFormatter();

  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Read-only"
        title="Accounts"
        description="Find an account by email, or a workspace by slug, and see what it holds and why. Every lookup is recorded under your name."
      />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) onSearch(query.trim());
        }}
      >
        <div className="min-w-64 flex-1">
          <Input
            label="Email or workspace slug"
            onChange={setQuery}
            value={query}
          />
        </div>
        <Button disabled={!query.trim() || isSearching} type="submit">
          {isSearching ? "Looking…" : "Look up"}
        </Button>
      </form>
      <AdminInlineStatus message={errorMessage} />
      {result ? (
        <section aria-label="Lookup result" className="space-y-4">
          {result.account ? (
            <article className="border-border bg-surface-container-lowest rounded-lg border p-5">
              <h2 className="type-title-medium text-ink-strong">
                {result.account.name} · {result.account.email}
              </h2>
              <p className="type-body-small text-ink-soft">
                Joined {formatDate(result.account.created_at, MEDIUM_DATE)} ·{" "}
                {result.account.email_verified
                  ? "email verified"
                  : "email not verified"}
              </p>
            </article>
          ) : null}
          {result.workspaces.length === 0 ? (
            <p className="type-body-medium text-ink-soft">
              {result.account
                ? "This account belongs to no workspace."
                : "Nothing matches that email or slug."}
            </p>
          ) : (
            result.workspaces.map((workspace) => (
              <WorkspaceCard key={workspace.id} workspace={workspace} />
            ))
          )}
        </section>
      ) : null}
    </AdminPageShell>
  );
}

function WorkspaceCard({ workspace }: WorkspaceCardProps) {
  const formatDate = useDateTimeFormatter();
  return (
    <article className="border-border bg-surface-container-lowest space-y-3 rounded-lg border p-5">
      <h3 className="type-title-medium text-ink-strong">
        {workspace.name}{" "}
        <span className="type-body-small text-ink-soft">/{workspace.slug}</span>
      </h3>
      <p className="type-body-small text-ink-soft">
        {workspace.members
          .map((member) => `${member.email} (${member.role})`)
          .join(", ")}
      </p>
      <h4 className="type-label-large text-ink-strong">Products</h4>
      {workspace.products.length === 0 ? (
        <p className="type-body-small text-ink-soft">No products.</p>
      ) : (
        <ul className="space-y-1">
          {workspace.products.map((product) => (
            <li
              key={product.product}
              className="type-body-small text-ink-strong flex flex-wrap gap-2"
            >
              <AdminStatusBadge
                compact
                tone={product.status === "active" ? "pass" : "warn"}
              >
                {product.status}
              </AdminStatusBadge>
              {product.product} since{" "}
              {formatDate(product.granted_at, MEDIUM_DATE)}
              {product.expires_at
                ? `, until ${formatDate(product.expires_at, MEDIUM_DATE)}`
                : ""}{" "}
              ·{" "}
              {product.purchase_intent_id
                ? `bought (${product.purchase_intent_id})`
                : "granted by hand"}
            </li>
          ))}
        </ul>
      )}
      <h4 className="type-label-large text-ink-strong">Purchases</h4>
      {workspace.purchases.length === 0 ? (
        <p className="type-body-small text-ink-soft">No purchases.</p>
      ) : (
        <ul className="space-y-1">
          {workspace.purchases.map((purchase) => (
            <li key={purchase.id} className="type-body-small text-ink-strong">
              {purchase.product} ({purchase.interval}) · {purchase.status} ·{" "}
              {formatDate(purchase.created_at, MEDIUM_DATE)}
              {purchase.revoked_at
                ? ` · revoked: ${purchase.revocation_reason ?? "no reason recorded"}`
                : ""}
            </li>
          ))}
        </ul>
      )}
      {workspace.adjustments.length > 0 ? (
        <>
          <h4 className="type-label-large text-ink-strong">Refunds</h4>
          <ul className="space-y-1">
            {workspace.adjustments.map((adjustment) => (
              <li
                key={`${adjustment.created_at}-${adjustment.kind}`}
                className="type-body-small text-ink-strong"
              >
                {adjustment.kind} of {(adjustment.amount / 100).toFixed(2)}{" "}
                {adjustment.currency.toUpperCase()} ·{" "}
                {formatDate(adjustment.created_at, MEDIUM_DATE)} ·{" "}
                {adjustment.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {workspace.discounts.length > 0 ? (
        <>
          <h4 className="type-label-large text-ink-strong">
            Discount requests
          </h4>
          <ul className="space-y-1">
            {workspace.discounts.map((discount) => (
              <li key={discount.id} className="type-body-small text-ink-strong">
                {discount.segment} · {discount.status} ·{" "}
                {formatDate(discount.submitted_at, MEDIUM_DATE)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}
