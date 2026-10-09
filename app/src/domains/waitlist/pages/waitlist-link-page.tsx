import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import type { WaitlistLinkKind } from "../contracts";
import { loadWaitlistLink, confirmWaitlist, loadWaitlistRequest } from "../waitlist.functions";
import { WaitlistLayout, WaitlistError } from "./waitlist-layout";
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
    <WaitlistLayout>
      {query.isPending ? (
        <div className="h-24" aria-busy="true" />
      ) : query.isError ? (
        <LinkUnavailable />
      ) : kind === "confirm" && !query.data.confirmedAt ? (
        <div className="space-y-5">
          <h1 className="type-display-small text-ink-strong">Confirm your email</h1>
          <p className="type-body-large text-ink-soft break-all">{query.data.email}</p>
          <Button
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
    <WaitlistLayout>
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
      <h1 className="type-display-small text-ink-strong">Link unavailable</h1>
      <p className="type-body-large text-ink-soft">This link has expired or is unavailable.</p>
      <Link to="/waitlist" className="type-label-large text-accent-deep inline-block underline">
        Request a new email link
      </Link>
    </div>
  );
}
