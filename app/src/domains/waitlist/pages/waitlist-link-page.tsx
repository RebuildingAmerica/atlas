import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import type { WaitlistLinkKind } from "../contracts";
import { loadWaitlistLink, confirmWaitlist, loadWaitlistRequest } from "../waitlist.functions";
import {
  WaitlistLayout,
  WaitlistError,
  waitlistPrimaryLinkClass,
  waitlistHeadingClass,
  waitlistTextLinkClass,
} from "./waitlist-layout";
import { WaitlistRequestPanel } from "./waitlist-request-panel";

export function WaitlistLinkPage({ token, kind }: { token: string; kind: WaitlistLinkKind }) {
  const [retried, setRetried] = useState(false);
  const focusResult = useCallback(
    (heading: HTMLHeadingElement | null) => {
      if (retried) heading?.focus();
    },
    [retried],
  );
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
    <WaitlistLayout wide={query.data?.status === "invited" && !query.data.purchasedAt}>
      {query.isPending ? (
        <div className="h-24" aria-busy="true" />
      ) : query.isError ? (
        <RequestLoadError
          error={query.error}
          focusOnMount={retried}
          retry={() => {
            setRetried(true);
            void query.refetch();
          }}
        />
      ) : query.data === null ? (
        <LinkUnavailable headingRef={focusResult} />
      ) : kind === "confirm" && !query.data.confirmedAt ? (
        <div className="space-y-5">
          <h1 ref={focusResult} tabIndex={-1} className={waitlistHeadingClass}>
            Confirm your email
          </h1>
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
        </div>
      ) : (
        <WaitlistRequestPanel
          key={`${query.data.id}:${query.data.status}:${query.data.purchasedAt}`}
          initialRequest={query.data}
          focusOnMount={retried || confirm.isSuccess}
          token={token}
          kind={kind}
        />
      )}
    </WaitlistLayout>
  );
}
export function WaitlistRequestPage({ id }: { id: string }) {
  const [retried, setRetried] = useState(false);
  const query = useQuery({
    queryKey: ["waitlist", "request", id],
    queryFn: () => loadWaitlistRequest({ data: { id } }),
    retry: false,
  });
  return (
    <WaitlistLayout wide={query.data?.status === "invited" && !query.data.purchasedAt}>
      {query.isPending ? (
        <div className="h-24" aria-busy="true" />
      ) : query.isError ? (
        <RequestLoadError
          error={query.error}
          focusOnMount={retried}
          retry={() => {
            setRetried(true);
            void query.refetch();
          }}
          redirect={`/waitlist/request/${id}`}
        />
      ) : (
        <WaitlistRequestPanel
          key={`${query.data.id}:${query.data.status}:${query.data.purchasedAt}`}
          initialRequest={query.data}
          focusOnMount={retried}
        />
      )}
    </WaitlistLayout>
  );
}
function RequestLoadError({
  error,
  retry,
  redirect,
  focusOnMount = false,
}: {
  error: unknown;
  retry: () => void;
  redirect?: string;
  focusOnMount?: boolean;
}) {
  const focusError = useCallback(
    (heading: HTMLHeadingElement | null) => {
      if (focusOnMount) heading?.focus();
    },
    [focusOnMount],
  );
  return (
    <div className="space-y-5">
      <h1 ref={focusError} tabIndex={-1} className={waitlistHeadingClass}>
        This request could not be opened
      </h1>
      <WaitlistError
        message={userFacingErrorMessage(error, "Your request couldn’t be loaded. Try again.")}
      />
      <div className="flex flex-wrap gap-4">
        <Button onClick={retry}>Try again</Button>
        {redirect ? (
          <Link to="/sign-in" search={{ redirect }} className={waitlistTextLinkClass}>
            Sign in
          </Link>
        ) : null}
        {redirect ? (
          <Link to="/waitlist" className={waitlistPrimaryLinkClass}>
            Get a new link
          </Link>
        ) : null}
      </div>
    </div>
  );
}
function LinkUnavailable({
  headingRef,
}: {
  headingRef: (heading: HTMLHeadingElement | null) => void;
}) {
  return (
    <div className="space-y-5">
      <h1 ref={headingRef} tabIndex={-1} className={waitlistHeadingClass}>
        This link no longer works
      </h1>
      <p className="type-body-large text-ink-soft">
        Request a fresh link with the email you used to join. Your place on the waitlist stays the
        same.
      </p>
      <Link to="/waitlist" className={waitlistPrimaryLinkClass}>
        Get a new link
      </Link>
    </div>
  );
}
