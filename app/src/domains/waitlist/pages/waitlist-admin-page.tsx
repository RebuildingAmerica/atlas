import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { Select } from "@rebuildingamerica/atlas-ui/ui/select";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import {
  AdminPageShell,
  AdminPageHeader,
  AdminInlineStatus,
  AdminIndicatorCard,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import {
  listWaitlistRequests,
  inviteWaitlistRequests,
  loadWaitlistStaffDetail,
  actOnWaitlistRequest,
} from "../waitlist.functions";
import type { StaffWaitlistAction } from "../waitlist.functions";
import type {
  WaitlistRequest,
  WaitlistStatus,
  WaitlistDeliveryStatus,
  WaitlistLinkKind,
} from "../contracts";
import { waitlistTextLinkClass } from "./waitlist-layout";

const requestStatusLabels: Record<WaitlistStatus, string> = {
  unconfirmed: "Email not confirmed",
  waiting: "Waiting",
  invited: "Invited",
  withdrawn: "Left waitlist",
  revoked: "Invitation withdrawn",
};
const deliveryStatusLabels: Record<WaitlistDeliveryStatus, string> = {
  pending: "Queued",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  unresolved: "Needs checking",
};
const deliveryKindLabels: Record<WaitlistLinkKind, string> = {
  confirm: "Email confirmation",
  invite: "Invitation",
  manage: "Waitlist link",
};

export function WaitlistAdminPage() {
  const queryClient = useQueryClient();
  const queue = useQuery({
    queryKey: ["admin", "waitlist"],
    queryFn: () => listWaitlistRequests(),
    retry: false,
  });
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("waiting");
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [revokeReview, setRevokeReview] = useState(false);
  const [notice, setNotice] = useState<string[]>([]);
  const detailQueryId = detailId ?? "";
  const detail = useQuery({
    queryKey: ["admin", "waitlist-detail", detailId],
    queryFn: () => loadWaitlistStaffDetail({ data: { id: detailQueryId } }),
    enabled: detailId !== null,
    retry: false,
  });
  const records = useMemo(() => queue.data?.records ?? [], [queue.data]);
  const filtered = useMemo(
    () =>
      records.filter(
        ({ request }) =>
          (!plan || request.product === plan) &&
          (!status ||
            (status === "purchased" ? Boolean(request.purchasedAt) : request.status === status)) &&
          `${request.email} ${request.name} ${request.organization}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [records, plan, status, search],
  );
  const canInvite = (request: WaitlistRequest) =>
    request.status === "waiting" &&
    queue.data?.availability.available === true &&
    queue.data.availability.allowedOffers.some((offer) => offer.startsWith(`${request.product}:`));
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin", "waitlist"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "waitlist-detail"] }),
    ]);
  }
  const invite = useMutation({
    mutationFn: (ids: string[]) => inviteWaitlistRequests({ data: { ids } }),
    onSuccess: async (response) => {
      setReview(false);
      setSelected([]);
      setNotice(
        response.results.map(
          (result) =>
            `${records.find((item) => item.request.id === result.id)?.request.email ?? "Request"}: ${result.message}`,
        ),
      );
      await refresh();
    },
  });
  const action = useMutation({
    mutationFn: (input: StaffWaitlistAction) => actOnWaitlistRequest({ data: input }),
    onSuccess: async (response) => {
      setRevokeReview(false);
      setNotice([
        response.delivery
          ? response.delivery.status === "sent"
            ? "Invitation sent."
            : "Invitation email needs attention."
          : "Invitation withdrawn.",
      ]);
      await refresh();
    },
  });
  const pending = invite.isPending || action.isPending;
  const error = queue.error ?? invite.error;
  const selectedRecords = records.filter((item) => selected.includes(item.request.id));
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Paid access"
        title="Waitlist"
        description="Choose who to invite and see who has signed up."
      >
        <Link to="/admin" className="type-label-medium text-accent-deep underline">
          Admin home
        </Link>
      </AdminPageHeader>
      <section className="grid gap-4 sm:grid-cols-3">
        <AdminIndicatorCard
          label="Waiting"
          value={
            queue.isPending
              ? "–"
              : String(records.filter((item) => item.request.status === "waiting").length)
          }
          detail="Confirmed requests"
          tone="neutral"
        />
        <AdminIndicatorCard
          label="Invited"
          value={
            queue.isPending
              ? "–"
              : String(records.filter((item) => item.request.status === "invited").length)
          }
          detail="Can sign up for a plan"
          tone="neutral"
        />
        <AdminIndicatorCard
          label="Signed up"
          value={
            queue.isPending
              ? "–"
              : String(records.filter((item) => item.request.purchasedAt).length)
          }
          detail="Payment complete"
          tone="pass"
        />
      </section>
      <AdminInlineStatus
        message={
          error
            ? userFacingErrorMessage(
                error,
                queue.isError
                  ? "Requests couldn’t be loaded. Try again."
                  : "Invitations couldn’t be sent. Try again.",
              )
            : undefined
        }
      />
      {queue.isError ? (
        <Button
          variant="secondary"
          onClick={() => {
            void queue.refetch();
          }}
        >
          Retry queue
        </Button>
      ) : null}
      {!detailId
        ? notice.map((message) => <AdminInlineStatus key={message} message={message} />)
        : null}
      {queue.data && !queue.data.availability.available ? (
        <p className="type-body-medium text-ink-soft">
          New signups are paused. You can send invitations when paid plans are available again.{" "}
          <Link to="/admin" className="text-accent-deep underline">
            Review paid plans
          </Link>
        </p>
      ) : null}
      <section aria-label="Waitlist filters" className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Search requests"
          type="search"
          name="search"
          autoComplete="off"
          placeholder="Email, name, or organization…"
          value={search}
          onChange={setSearch}
          density="comfortable"
        />
        <Select
          label="Plan"
          name="plan"

          value={plan}
          density="comfortable"
          onChange={setPlan}
          options={[
            { value: "", label: "All plans" },
            { value: "atlas_pro", label: "Atlas Pro" },
            { value: "atlas_team", label: "Atlas Team" },
            { value: "atlas_research_pass", label: "Atlas Research Pass" },
          ]}
        />
        <Select
          label="Status"
          name="status"

          value={status}
          density="comfortable"
          onChange={setStatus}
          options={[
            { value: "", label: "All requests" },
            { value: "unconfirmed", label: "Email not confirmed" },
            { value: "waiting", label: "Waiting" },
            { value: "invited", label: "Invited" },
            { value: "purchased", label: "Signed up" },
            { value: "withdrawn", label: "Left waitlist" },
            { value: "revoked", label: "Invitation withdrawn" },
          ]}
        />
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={pending || !filtered.some((item) => canInvite(item.request))}
          onClick={() => {
            setSelected(
              filtered
                .filter((item) => canInvite(item.request))
                .slice(0, 50)
                .map((item) => item.request.id),
            );
          }}
        >
          Select up to 50
        </Button>
        <Button
          disabled={pending || selected.length === 0}
          onClick={() => {
            setReview(true);
          }}
        >
          {selected.length === 1
            ? "Review 1 invitation"
            : `Review ${selected.length || "selected"} invitations`}
        </Button>
      </div>
      {review ? (
        <section
          aria-label="Review invitations"
          className="border-border bg-surface-container-lowest space-y-4 rounded-xl border p-5"
        >
          <h2 className="type-title-large">Send these invitations?</h2>
          <ul className="type-body-medium space-y-2">
            {selectedRecords.map(({ request }) => (
              <li key={request.id} className="break-words">
                {request.email} · {PRODUCT_LABELS[request.product]}
              </li>
            ))}
          </ul>
          <p className="type-body-small text-ink-soft">
            Each person will get an email inviting them to sign up for their plan. They’ll choose a
            payment option and pay at checkout.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={pending}
              onClick={() => {
                invite.mutate(selected);
              }}
            >
              Send invitations
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setReview(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
      <section aria-label="Waitlist requests" aria-busy={queue.isPending} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="type-title-large text-ink-strong">Requests</h2>
          <p className="type-body-small text-ink-muted tabular-nums">
            {selected.length} selected · 50 maximum
          </p>
        </div>
        {!queue.isPending && !queue.isError && !filtered.length ? (
          <p className="type-body-medium text-ink-soft">No requests.</p>
        ) : null}
        {filtered.map(({ request, deliveries }) => (
          <article
            key={request.id}
            className="border-border bg-surface-container-lowest flex flex-wrap items-start gap-3 rounded-xl border p-4 sm:gap-4"
          >
            <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                className="h-5 w-5"
                aria-label={`Select ${request.email}`}
                disabled={pending || !canInvite(request)}
                checked={selected.includes(request.id)}
                onChange={(event) => {
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, request.id].slice(0, 50)
                      : current.filter((id) => id !== request.id),
                  );
                }}
              />
            </label>
            <div className="min-w-0 flex-1 space-y-1">
              <button
                type="button"
                className={`${waitlistTextLinkClass} min-h-0 text-left break-all`}
                onClick={() => {
                  setDetailId(request.id);
                  setNotice([]);
                  setRevokeReview(false);
                }}
              >
                {request.name || request.email}
              </button>
              {request.name ? (
                <p className="type-body-small text-ink-soft break-all">{request.email}</p>
              ) : null}
              <p className="type-body-medium">
                {PRODUCT_LABELS[request.product]} ·{" "}
                {request.purchasedAt ? "Signed up" : requestStatusLabels[request.status]}
              </p>
              <p className="type-body-small text-ink-muted">
                {request.confirmedAt
                  ? `Confirmed ${new Date(request.confirmedAt).toLocaleDateString()}`
                  : "Email not confirmed"}
                {deliveries[0]
                  ? ` · Email ${deliveryStatusLabels[deliveries[0].status].toLowerCase()}`
                  : ""}
              </p>
            </div>
            {canInvite(request) ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setSelected([request.id]);
                  setReview(true);
                }}
              >
                Invite
              </Button>
            ) : null}
          </article>
        ))}
      </section>
      {detailId ? (
        <Dialog
          open
          onClose={() => {
            setDetailId(null);
          }}
          className="fixed inset-0 z-50"
        >
          <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
          <div className="fixed inset-0 overflow-y-auto overscroll-contain p-4 sm:p-8">
            <div className="flex min-h-full items-center justify-center">
              <DialogPanel className="border-border bg-surface-container-lowest w-full max-w-2xl space-y-6 rounded-2xl border p-5 shadow-xl sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  <DialogTitle className="type-title-large">Request details</DialogTitle>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDetailId(null);
                    }}
                  >
                    Close details
                  </Button>
                </div>
                {notice.map((message) => (
                  <AdminInlineStatus key={message} message={message} />
                ))}
                <AdminInlineStatus
                  message={
                    action.isError
                      ? userFacingErrorMessage(
                          action.error,
                          "This change couldn’t be saved. Try again.",
                        )
                      : undefined
                  }
                />
                {detail.isError ? (
                  <div className="space-y-3">
                    <AdminInlineStatus message="Request details couldn’t be loaded." />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void detail.refetch();
                      }}
                    >
                      Try again
                    </Button>
                  </div>
                ) : detail.data ? (
                  <>
                    <dl className="type-body-medium grid gap-3 sm:grid-cols-2">
                      <div>
                        <dt className="text-ink-muted">Email</dt>
                        <dd className="break-all">{detail.data.request.email}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Plan</dt>
                        <dd>{PRODUCT_LABELS[detail.data.request.product]}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Name</dt>
                        <dd className="break-words">
                          {detail.data.request.name || "Not provided"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Organization</dt>
                        <dd className="break-words">
                          {detail.data.request.organization || "Not provided"}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-ink-muted">Intended use</dt>
                        <dd className="break-words whitespace-pre-wrap">
                          {detail.data.request.intendedUse || "Not provided"}
                        </dd>
                      </div>
                    </dl>
                    {detail.data.request.status === "invited" ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-3">
                          <Button
                            variant="secondary"
                            disabled={pending || !queue.data?.availability.available}
                            onClick={() => {
                              action.mutate({ id: detailId, action: "resend" });
                            }}
                          >
                            Resend invitation
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={pending}
                            onClick={() => {
                              setRevokeReview(true);
                            }}
                          >
                            Withdraw invitation
                          </Button>
                        </div>
                        {revokeReview ? (
                          <div className="space-y-3">
                            <p className="type-body-medium">
                              Withdraw this invitation? They won’t be able to start a new purchase
                              with it. Any paid plan they already have will stay active.
                            </p>
                            <div className="flex flex-wrap gap-3">
                              <Button
                                disabled={pending}
                                onClick={() => {
                                  action.mutate({ id: detailId, action: "revoke" });
                                }}
                              >
                                Confirm withdrawal
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setRevokeReview(false);
                                }}
                              >
                                Keep invitation
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <h3 className="type-title-medium">Email history</h3>
                    <p className="type-body-small text-ink-soft">
                      Sent means the email provider accepted the message. If an outcome needs
                      checking, retry the email before sending a new invitation.
                    </p>
                    <ul className="space-y-2">
                      {detail.data.deliveries.map((delivery) => (
                        <li
                          key={delivery.id}
                          className="type-body-small flex flex-wrap items-center gap-3"
                        >
                          <span>
                            {deliveryKindLabels[delivery.kind]} ·{" "}
                            {deliveryStatusLabels[delivery.status]} ·{" "}
                            {new Date(delivery.createdAt).toLocaleString()}
                          </span>
                          {delivery.kind === "invite" &&
                          delivery.status !== "sent" &&
                          detail.data.request.status === "invited" ? (
                            <Button
                              variant="secondary"
                              disabled={pending || !queue.data?.availability.available}
                              onClick={() => {
                                action.mutate({
                                  id: detailId,
                                  action: "retry",
                                  deliveryId: delivery.id,
                                });
                              }}
                            >
                              Retry email
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <h3 className="type-title-medium">Activity</h3>
                    <ol className="type-body-small space-y-2 break-words">
                      {detail.data.events.map((event) => (
                        <li key={event.id}>
                          <span className="capitalize">{event.action.replaceAll("_", " ")}</span> ·{" "}
                          {new Date(event.createdAt).toLocaleString()}
                          {event.actorId ? ` · ${event.actorId}` : ""}
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <div className="h-12" aria-busy="true" />
                )}
              </DialogPanel>
            </div>
          </div>
        </Dialog>
      ) : null}
    </AdminPageShell>
  );
}
