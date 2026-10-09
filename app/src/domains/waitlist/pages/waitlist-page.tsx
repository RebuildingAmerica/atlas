import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { loadPaidAccess, submitWaitlist } from "../waitlist.functions";
import type { WaitlistProduct } from "../contracts";
import { WaitlistLayout, WaitlistError, waitlistFieldClass } from "./waitlist-layout";

interface WaitlistPageProps {
  product?: WaitlistProduct;
  interval?: "monthly" | "yearly" | "four_month" | "weekly" | "once";
}
export function WaitlistPage({ product: selectedProduct, interval }: WaitlistPageProps) {
  const session = useAtlasSession();
  const [email, setEmail] = useState(session.data?.user.email ?? "");
  const [product, setProduct] = useState<WaitlistProduct | "">(selectedProduct ?? "");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [intendedUse, setIntendedUse] = useState("");
  const [website, setWebsite] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const access = useQuery({
    queryKey: ["waitlist", "access"],
    queryFn: () => loadPaidAccess(),
    retry: false,
  });
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => {
      setCooldown(false);
    }, 60_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [cooldown]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!product) return;
    setPending(true);
    setError(null);
    try {
      await submitWaitlist({
        data: {
          email,
          product,
          interval: product === selectedProduct ? interval : undefined,
          name,
          organization,
          intendedUse,
          website,
        },
      });
      setSent(true);
      setCooldown(true);
    } catch (error) {
      setError(
        userFacingErrorMessage(
          error,
          "Your waitlist email could not be sent. Try again in a minute.",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <WaitlistLayout>
      {sent ? (
        <div className="space-y-5">
          <p className="type-label-medium text-ink-muted">Atlas waitlist</p>
          <h1 className="type-display-small text-ink-strong">Check your email</h1>
          <p className="type-body-large text-ink-soft">
            A link for your Atlas request is on its way to{" "}
            <strong className="break-all">{email}</strong>.
          </p>
          <WaitlistError message={error} />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={pending || cooldown}
              onClick={() => {
                void submit();
              }}
            >
              Resend email
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSent(false);
                setError(null);
              }}
            >
              Change email
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <header className="space-y-3">
            <p className="type-label-medium text-ink-muted">Paid Atlas plans</p>
            <h1 className="type-display-small text-ink-strong">Join the waitlist</h1>
            <p className="type-body-large text-ink-soft">
              More research capacity for you. A shared workspace for your team.
            </p>
            <p className="type-body-medium text-ink-soft">
              Paid plans are available by invitation. Joining costs nothing. Public Atlas and free
              accounts remain open.
            </p>
          </header>
          {access.data?.requests.length ? (
            <section className="space-y-2" aria-label="Your requests">
              {access.data.requests.map((request) => (
                <Link
                  key={request.id}
                  to="/waitlist/request/$id"
                  params={{ id: request.id }}
                  className="border-border text-accent-deep block rounded-xl border p-3 underline"
                >
                  {PRODUCT_LABELS[request.product]} ·{" "}
                  {request.status === "invited" ? "Continue signup" : "View request"}
                </Link>
              ))}
            </section>
          ) : null}
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="space-y-5"
          >
            <label className="type-label-large block space-y-2">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
                className={waitlistFieldClass}
              />
            </label>
            <label className="type-label-large block space-y-2">
              <span id="waitlist-plan-label">Plan</span>
              <select
                aria-labelledby="waitlist-plan-label"
                required
                value={product}
                onChange={(event) => {
                  setProduct(event.target.value as WaitlistProduct | "");
                }}
                className={waitlistFieldClass}
              >
                <option value="">Choose a plan</option>
                <option value="atlas_pro">Atlas Pro</option>
                <option value="atlas_team">Atlas Team</option>
                <option value="atlas_research_pass">Atlas Research Pass</option>
              </select>
            </label>
            <details className="border-border rounded-xl border p-4">
              <summary className="type-label-large cursor-pointer">Add context (optional)</summary>
              <div className="mt-4 space-y-4">
                <label className="type-label-large block space-y-2">
                  <span>Name</span>
                  <input
                    autoComplete="name"
                    maxLength={120}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    className={waitlistFieldClass}
                  />
                </label>
                <label className="type-label-large block space-y-2">
                  <span>Organization</span>
                  <input
                    autoComplete="organization"
                    maxLength={200}
                    value={organization}
                    onChange={(event) => {
                      setOrganization(event.target.value);
                    }}
                    className={waitlistFieldClass}
                  />
                </label>
                <label className="type-label-large block space-y-2">
                  <span>What would you use Atlas for?</span>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={intendedUse}
                    onChange={(event) => {
                      setIntendedUse(event.target.value);
                    }}
                    className={waitlistFieldClass}
                  />
                </label>
              </div>
            </details>
            <label hidden aria-hidden="true">
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => {
                  setWebsite(event.target.value);
                }}
              />
            </label>
            <p className="type-body-small text-ink-muted">
              Emails about this request and your invitation only.{" "}
              <Link to="/privacy" className="underline">
                Privacy
              </Link>
            </p>
            <WaitlistError message={error} />
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Sending…" : "Join waitlist"}
            </Button>
          </form>
          <Link to="/pricing" className="type-label-medium text-accent-deep inline-block underline">
            Compare plans and pricing
          </Link>
        </div>
      )}
    </WaitlistLayout>
  );
}
