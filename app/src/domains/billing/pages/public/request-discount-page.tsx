import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { DiscountVerificationSection } from "@/domains/billing/verification/discount-verification-section";

/**
 * Page for users to request discount access.
 *
 * Available both before and after signup:
 * - Unauthenticated users see general info and a note to sign up first
 * - Authenticated users can submit verification requests directly
 */
export function RequestDiscountPage() {
  const atlasSession = useAtlasSession();
  const isAuthenticated = Boolean(atlasSession.data?.user.id);

  if (atlasSession.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 py-10 lg:py-16">
        <p className="type-title-large text-ink-strong">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-8 py-10 lg:py-16">
        <div className="space-y-2">
          <p className="type-label-medium text-ink-muted">Discount access</p>
          <h1 className="type-display-small text-ink-strong">Get discounted access to Atlas</h1>
          <p className="type-body-large text-ink-soft">
            If you're an independent journalist, work at a grassroots nonprofit, or build civic
            tech, Atlas offers discounted access to support public-interest work.
          </p>
        </div>

        <div className="border-border bg-surface-container-lowest space-y-4 rounded-[1.4rem] border p-5">
          <p className="type-title-small text-ink-strong">
            We're here to support public-interest research
          </p>
          <p className="type-body-medium text-ink-soft">
            Atlas pricing is designed to be accessible. We offer discounts for:
          </p>

          <ul className="space-y-2 pl-4">
            <li className="type-body-medium text-ink-soft">
              <strong>Independent journalists</strong> — 50% off Atlas Pro
            </li>
            <li className="type-body-medium text-ink-soft">
              <strong>Grassroots nonprofits</strong> under $2M annual budget — 40% off Atlas Pro
            </li>
            <li className="type-body-medium text-ink-soft">
              <strong>Civic tech workers</strong> building tools for government accountability — 50%
              off Atlas Pro
            </li>
          </ul>

          <p className="type-body-medium text-ink-soft mt-4">
            To request a discount, you'll need to create an Atlas account and verify your
            eligibility. We review each request and email you within 24 hours.
          </p>
        </div>

        <div className="border-border rounded-[1.4rem] border bg-white p-5">
          <p className="type-title-small text-ink-strong mb-3">Ready to get started?</p>
          <a
            href="/sign-in"
            className="bg-ink-strong hover:bg-ink-muted type-body-medium inline-flex items-center gap-2 rounded-lg px-4 py-2 text-white transition-colors"
          >
            Create account
          </a>
          <p className="type-body-small text-ink-soft mt-3">
            Already have an account?{" "}
            <a href="/sign-in" className="text-ink-strong hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 py-10 lg:py-16">
      <div className="space-y-2">
        <p className="type-label-medium text-ink-muted">Discount access</p>
        <h1 className="type-display-small text-ink-strong">Request discount access</h1>
        <p className="type-body-large text-ink-soft">
          If you qualify for a discount, submit your information and we'll review your request
          within 24 hours.
        </p>
      </div>

      <DiscountVerificationSection userId={atlasSession.data?.user.id || ""} />

      <div className="border-border bg-surface-container-lowest rounded-[1.4rem] border p-5">
        <p className="type-title-small text-ink-strong">How verification works</p>
        <p className="type-body-medium text-ink-soft mt-2">
          When you submit a discount request, our team reviews the information you provide. We'll
          email you to confirm whether you qualify. Verification can take up to 24 hours.
        </p>

        <div className="mt-4 space-y-2">
          <p className="type-body-small text-ink-soft">
            <strong>Independent journalists:</strong> We'll verify your published work and byline.
          </p>
          <p className="type-body-small text-ink-soft">
            <strong>Grassroots nonprofits:</strong> We'll verify your 501(c)(3) status and annual
            budget.
          </p>
          <p className="type-body-small text-ink-soft">
            <strong>Civic tech workers:</strong> We'll verify your project and its civic mission.
          </p>
        </div>
      </div>
    </div>
  );
}
