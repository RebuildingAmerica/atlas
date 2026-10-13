# Stripe billing deployment

Atlas uses Stripe test mode in staging and live mode in production. The public
application origin determines the webhook endpoint at `/api/stripe/webhook`.

Run `pnpm setup:staging` for test-mode catalog work and `pnpm setup:prod --live`
for live-mode work. These commands update local target environment files; the
protected Cloudflare publication workflow receives the corresponding GitHub
environment settings.

Before opening sales, verify the selected catalog with `pnpm stripe:verify:prod`
and complete a protected deployed checkout, entitlement update, and signed
webhook receipt. The application closes new sales unless its production offer
allowlist explicitly includes the requested offer.
