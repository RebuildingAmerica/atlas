import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import {
  AdminPageShell,
  AdminPageHeader,
  AdminInlineStatus,
  AdminIndicatorCard,
} from "@/domains/admin/admin-portal";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import {
  listWaitlistRequests,
  inviteWaitlistRequests,
  loadWaitlistStaffDetail,
  actOnWaitlistRequest,
} from "../waitlist.functions";
import type { StaffWaitlistAction } from "../waitlist.functions";
import type { WaitlistRequest } from "../contracts";
import { waitlistFieldClass } from "./waitlist-layout";

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
  const [notice, setNotice] = useState<string | undefined>();
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
        response.results
          .map(
            (result) =>
              `${records.find((item) => item.request.id === result.id)?.request.email ?? "Request"}: ${result.message}`,
          )
          .join(" "),
      );
      await refresh();
    },
  });
  const action = useMutation({
    mutationFn: (input: StaffWaitlistAction) => actOnWaitlistRequest({ data: input }),
    onSuccess: async (response) => {
      setRevokeReview(false);
      setNotice(
        response.delivery
          ? response.delivery.status === "sent"
            ? "Invitation sent."
            : "Invitation email needs attention."
          : "Purchase permission revoked.",
      );
      await refresh();
    },
  });
  const pending = invite.isPending || action.isPending;
  const error = queue.error ?? invite.error ?? action.error;
  const selectedRecords = records.filter((item) => selected.includes(item.request.id));
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Paid access"
        title="Waitlist"
        description="Review requests, invite people, and follow their signup."
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
          detail="Permission to purchase"
          tone="neutral"
        />
        <AdminIndicatorCard
          label="Purchased"
          value={
            queue.isPending
              ? "–"
              : String(records.filter((item) => item.request.purchasedAt).length)
          }
          detail="Completed payment"
          tone="pass"
        />
      </section>
      <AdminInlineStatus
        message={
          error
            ? userFacingErrorMessage(error, "Waitlist requests could not load. Try again.")
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
      <AdminInlineStatus message={notice} />
      {queue.data && !queue.data.availability.available ? (
        <p className="type-body-medium text-ink-soft">
          Paid purchases are paused. Invitations are unavailable.{" "}
          <Link to="/admin" className="text-accent-deep underline">
            Review readiness
          </Link>
        </p>
      ) : null}
      <section aria-label="Waitlist filters" className="grid gap-4 sm:grid-cols-3">
        <label className="type-label-medium block space-y-2">
          <span>Search requests</span>
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            className={waitlistFieldClass}
          />
        </label>
        <label className="type-label-medium block space-y-2">
          <span id="waitlist-plan-label">Plan</span>
          <select
            aria-labelledby="waitlist-plan-label"
            value={plan}
            onChange={(event) => {
              setPlan(event.target.value);
            }}
            className={waitlistFieldClass}
          >
            <option value="">All plans</option>
            <option value="atlas_pro">Atlas Pro</option>
            <option value="atlas_team">Atlas Team</option>
            <option value="atlas_research_pass">Atlas Research Pass</option>
          </select>
        </label>
        <label className="type-label-medium block space-y-2">
          <span id="waitlist-status-label">Status</span>
          <select
            aria-labelledby="waitlist-status-label"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
            className={waitlistFieldClass}
          >
            <option value="">All requests</option>
            <option value="unconfirmed">Unconfirmed</option>
            <option value="waiting">Waiting</option>
            <option value="invited">Invited</option>
            <option value="purchased">Purchased</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="revoked">Revoked</option>
          </select>
        </label>
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
          Select eligible requests
        </Button>
        <Button
          disabled={pending || selected.length === 0}
          onClick={() => {
            setReview(true);
          }}
        >
          Review {selected.length || "selected"} invitations
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
            Each person receives permission to purchase the listed plan and an invitation email.
          </p>
          <div className="flex gap-3">
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
        <h2 className="type-title-large text-ink-strong">Requests</h2>
        {!queue.isPending && !queue.isError && !filtered.length ? (
          <p className="type-body-medium text-ink-soft">No requests.</p>
        ) : null}
        {filtered.map(({ request, deliveries }) => (
          <article
            key={request.id}
            className="border-border bg-surface-container-lowest flex items-start gap-4 rounded-xl border p-4"
          >
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 shrink-0"
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
            <div className="min-w-0 flex-1 space-y-1">
              <button
                type="button"
                className="type-label-large text-accent-deep text-left break-all underline"
                onClick={() => {
                  setDetailId(request.id);
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
                {request.purchasedAt ? "Purchased" : request.status}
              </p>
              <p className="type-body-small text-ink-muted">
                {request.confirmedAt
                  ? `Confirmed ${new Date(request.confirmedAt).toLocaleDateString()}`
                  : "Email unconfirmed"}
                {deliveries[0] ? ` · Email ${deliveries[0].status}` : ""}
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
        <section
          aria-label="Request details"
          className="border-border bg-surface-container-lowest space-y-4 rounded-xl border p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="type-title-large">Request details</h2>
            <Button
              variant="ghost"
              onClick={() => {
                setDetailId(null);
              }}
            >
              Close details
            </Button>
          </div>
          {detail.isError ? (
            <AdminInlineStatus message="Request details could not load." />
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
                  <dd>{detail.data.request.name || "Not provided"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Organization</dt>
                  <dd>{detail.data.request.organization || "Not provided"}</dd>
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
                      Revoke purchase permission
                    </Button>
                  </div>
                  {revokeReview ? (
                    <div className="space-y-3">
                      <p className="type-body-medium">
                        Block future purchases with this invitation? Existing paid access continues.
                      </p>
                      <div className="flex gap-3">
                        <Button
                          disabled={pending}
                          onClick={() => {
                            action.mutate({ id: detailId, action: "revoke" });
                          }}
                        >
                          Confirm revocation
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setRevokeReview(false);
                          }}
                        >
                          Keep permission
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <h3 className="type-title-medium">Email history</h3>
              <ul className="space-y-2">
                {detail.data.deliveries.map((delivery) => (
                  <li
                    key={delivery.id}
                    className="type-body-small flex flex-wrap items-center gap-3"
                  >
                    <span>
                      {delivery.kind} · {delivery.status} ·{" "}
                      {new Date(delivery.createdAt).toLocaleString()}
                    </span>
                    {delivery.kind === "invite" &&
                    delivery.status !== "sent" &&
                    detail.data.request.status === "invited" ? (
                      <Button
                        variant="secondary"
                        disabled={pending || !queue.data?.availability.available}
                        onClick={() => {
                          action.mutate({ id: detailId, action: "retry", deliveryId: delivery.id });
                        }}
                      >
                        Retry failed email
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <h3 className="type-title-medium">Activity</h3>
              <ol className="type-body-small space-y-2">
                {detail.data.events.map((event) => (
                  <li key={event.id}>
                    {event.action} · {new Date(event.createdAt).toLocaleString()}
                    {event.actorId ? ` · ${event.actorId}` : ""}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="h-12" aria-busy="true" />
          )}
        </section>
      ) : null}
    </AdminPageShell>
  );
}
