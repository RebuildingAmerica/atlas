import { Mail, Link2Off } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import type { WaitlistLinkKind } from "../contracts";
import { loadWaitlistLink, confirmWaitlist, loadWaitlistRequest } from "../waitlist.functions";
import {
  WaitlistLayout,
  WaitlistError,
  waitlistPrimaryLinkClass,
  WaitlistFooter,
} from "./waitlist-layout";
import { WaitlistRequestPanel } from "./waitlist-request-panel";

export function WaitlistLinkPage({ token, kind }: { token: string; kind: WaitlistLinkKind }) {
  const queryClient = useQueryClient();
  const queryKey = ["waitlist", "link", token, kind];
  const query = useQuery({
    queryKey,
    queryFn: () => loadWaitlistLink({ data: { token, kind } }),
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: () => confirmWaitlist({ data: { token } }),
    onSuccess: (request) => {
      queryClient.setQueryData(queryKey, request);
      void queryClient.invalidateQueries({ queryKey: ["waitlist", "access"] });
    },
  });
  return (
    <WaitlistLayout showBrowseLink={false}>
      {query.isPending ? (
        <div className="h-24" aria-busy="true" />
      ) : query.isError ? (
        <LinkUnavailable />
      ) : kind === "confirm" && !query.data.confirmedAt ? (
        <div className="space-y-5">
          <div className="bg-surface-container text-accent-deep flex h-12 w-12 items-center justify-center rounded-2xl">
            <Mail className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="type-display-small text-ink-strong text-balance">Confirm your email</h1>
          <p className="type-body-large text-ink-soft">
            Confirm <strong className="text-ink-strong break-all">{query.data.email}</strong> to
            join the waitlist. We’ll send your invitation to this address.
          </p>
          <Button
            className="w-full"
            size="lg"
            disabled={confirm.isPending}
            onClick={() => {
              confirm.mutate();
            }}
          >
            Confirm email
          </Button>
          <WaitlistError
            message={confirm.isError ? "Your email could not be confirmed. Try again." : null}
          />
          <WaitlistFooter />
        </div>
      ) : (
        <WaitlistRequestPanel
          key={`${query.data.id}:${query.data.status}:${query.data.purchasedAt}`}
          initialRequest={query.data}
          token={token}
          kind={kind}
        />
      )}
    </WaitlistLayout>
  );
}
export function WaitlistRequestPage({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["waitlist", "request", id],
    queryFn: () => loadWaitlistRequest({ data: { id } }),
    retry: false,
  });
  return (
    <WaitlistLayout showBrowseLink={false}>
      {query.isPending ? (
        <div className="h-24" aria-busy="true" />
      ) : query.isError ? (
        <LinkUnavailable />
      ) : (
        <WaitlistRequestPanel
          key={`${query.data.id}:${query.data.status}:${query.data.purchasedAt}`}
          initialRequest={query.data}
        />
      )}
    </WaitlistLayout>
  );
}
function LinkUnavailable() {
  return (
    <div className="space-y-5">
      <div className="bg-surface-container text-accent-deep flex h-12 w-12 items-center justify-center rounded-2xl">
        <Link2Off className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="type-display-small text-ink-strong text-balance">This link no longer works</h1>
      <p className="type-body-large text-ink-soft">
        Request a fresh link with the email you used to join. Your place on the waitlist stays the
        same.
      </p>
      <Link to="/waitlist" className={waitlistPrimaryLinkClass}>
        Get a new link
      </Link>
      <WaitlistFooter />
    </div>
  );
}
