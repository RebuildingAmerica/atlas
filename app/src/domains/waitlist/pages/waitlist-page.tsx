import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";
import { loadPaidAccess, submitWaitlist } from "../waitlist.functions";
import type { WaitlistProduct } from "../contracts";
import {
  WaitlistLayout,
  WaitlistError,
  waitlistFieldClass,
  waitlistSummaryClass,
  waitlistTextLinkClass,
  waitlistHeadingClass,
} from "./waitlist-layout";

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
  const focusReceipt = useCallback((heading: HTMLHeadingElement | null) => {
    heading?.focus();
  }, []);
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
          <h1 ref={focusReceipt} tabIndex={-1} className={waitlistHeadingClass}>
            Check your email
          </h1>
          <p className="type-body-large text-ink-soft">
            We’ve sent a link to <strong className="text-ink-strong break-all">{email}</strong>.
            Open it to confirm or view your waitlist request.
          </p>
          <p className="type-body-medium text-ink-soft">Can’t find it? Check your spam folder.</p>
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
          {cooldown ? (
            <p role="status" className="type-body-small text-ink-muted">
              You can resend the email in a minute.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          <header className="space-y-3">
            <h1 className={waitlistHeadingClass}>Join the waitlist</h1>
            <p className="type-body-large text-ink-soft">
              We’ll email you when you can sign up for a paid plan. Keep using Atlas for free while
              you wait.
            </p>
          </header>
          {access.data?.requests.length ? (
            <section className="space-y-2" aria-label="Your requests">
              {access.data.requests.map((request) => (
                <Link
                  key={request.id}
                  to="/waitlist/request/$id"
                  params={{ id: request.id }}
                  className={`${waitlistTextLinkClass} border-border block rounded-xl border p-3`}
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
            <label className="type-label-large flex flex-col gap-3">
              <span>Email</span>
              <input
                type="email"
                name="email"
                spellCheck={false}
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
            <label className="type-label-large flex flex-col gap-3">
              <span id="waitlist-plan-label">Plan</span>
              <select
                aria-labelledby="waitlist-plan-label"
                name="product"
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
            <details>
              <summary className={waitlistSummaryClass}>About you (optional)</summary>
              <div className="mt-4 space-y-4">
                <label className="type-label-large flex flex-col gap-3">
                  <span>Name</span>
                  <input
                    name="name"
                    autoComplete="name"
                    maxLength={120}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    className={waitlistFieldClass}
                  />
                </label>
                <label className="type-label-large flex flex-col gap-3">
                  <span>Organization</span>
                  <input
                    name="organization"
                    autoComplete="organization"
                    maxLength={200}
                    value={organization}
                    onChange={(event) => {
                      setOrganization(event.target.value);
                    }}
                    className={waitlistFieldClass}
                  />
                </label>
                <label className="type-label-large flex flex-col gap-3">
                  <span>What would you use Atlas for?</span>
                  <textarea
                    name="intendedUse"
                    autoComplete="off"
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
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => {
                  setWebsite(event.target.value);
                }}
              />
            </label>
            <p className="type-body-small text-ink-muted">
              We’ll only email you about your waitlist request.{" "}
              <Link to="/privacy" className="underline">
                Privacy
              </Link>
            </p>
            <WaitlistError message={error} />
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Sending…" : "Join waitlist"}
            </Button>
          </form>
          <Link to="/pricing" className={waitlistTextLinkClass}>
            Compare plans and pricing
          </Link>
        </div>
      )}
    </WaitlistLayout>
  );
}
