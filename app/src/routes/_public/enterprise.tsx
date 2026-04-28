import { Link, createFileRoute } from "@tanstack/react-router";
import { PageLayout } from "@/platform/layout/page-layout";
import { Button } from "@/platform/ui/button";

export const Route = createFileRoute("/_public/enterprise")({
  component: EnterprisePage,
});

interface EnterpriseFeature {
  title: string;
  body: string;
}

const ENTERPRISE_FEATURES: readonly EnterpriseFeature[] = [
  {
    title: "Single Sign-On",
    body: "Bring your own identity provider — SAML 2.0 or OIDC. Domain verification, in-place certificate rotation, and a built-in health probe keep the integration working through normal IdP key rolls.",
  },
  {
    title: "Workspace governance",
    body: "Up to 50 members per workspace, role-based access for owners and admins, and shared notes, watchlists, and lists so your team's research stays in one place.",
  },
  {
    title: "MCP and OAuth access",
    body: "First-class OAuth 2.1 + MCP authorization server. Issue API keys, register your own OAuth clients, and pull Atlas data into your AI tools without leaving the platform.",
  },
  {
    title: "Fast onboarding",
    body: "Most teams are signed in via SSO within the same day. Paste your IdP metadata XML, verify a DNS TXT record, and you're done — no professional services required.",
  },
] as const;

interface EnterpriseStep {
  index: string;
  title: string;
  body: string;
}

const ENTERPRISE_STEPS: readonly EnterpriseStep[] = [
  {
    index: "01",
    title: "Create your account",
    body: "Sign up with your work email. We'll send a sign-in link — no password to remember.",
  },
  {
    index: "02",
    title: "Activate Atlas Team",
    body: "Choose Atlas Team at checkout. The team workspace and SSO controls unlock as soon as the payment confirms.",
  },
  {
    index: "03",
    title: "Configure SSO",
    body: "Paste your IdP metadata, publish the DNS TXT record we generate, and route everyone in your domain through your existing identity provider.",
  },
] as const;

function EnterprisePage() {
  return (
    <PageLayout className="py-10 lg:py-16">
      <section className="mx-auto w-full max-w-3xl space-y-12">
        <div className="space-y-4">
          <p className="type-label-medium text-ink-muted tracking-wider uppercase">
            Atlas for teams
          </p>
          <h1 className="type-display-small text-ink-strong leading-tight">
            Enterprise SSO for civic research teams.
          </h1>
          <p className="type-body-large text-ink-soft leading-relaxed">
            Atlas Team brings the same Atlas you already know — a sourced, transparent civic
            directory — into your organization with single sign-on, shared lists, and audit-friendly
            access controls.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link to="/sign-up" search={{ intent: "team-sso" }} className="no-underline">
              <Button variant="primary">Get started with team SSO</Button>
            </Link>
            <Link to="/pricing" className="no-underline">
              <Button variant="secondary">See pricing</Button>
            </Link>
          </div>
        </div>

        <div className="border-border space-y-6 rounded-[1.25rem] border bg-white p-6">
          <p className="type-label-medium text-ink-muted tracking-wider uppercase">What you get</p>
          <ul className="grid gap-5 sm:grid-cols-2">
            {ENTERPRISE_FEATURES.map((feature) => (
              <li key={feature.title} className="space-y-1.5">
                <p className="type-title-small text-ink-strong font-medium">{feature.title}</p>
                <p className="type-body-small text-ink-soft leading-relaxed">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-6">
          <p className="type-label-medium text-ink-muted tracking-wider uppercase">
            How onboarding works
          </p>
          <ol className="space-y-4">
            {ENTERPRISE_STEPS.map((step) => (
              <li
                key={step.index}
                className="border-border flex gap-4 rounded-[1rem] border bg-white p-5"
              >
                <span className="type-title-small text-ink-muted font-mono">{step.index}</span>
                <div className="space-y-1">
                  <p className="type-title-small text-ink-strong font-medium">{step.title}</p>
                  <p className="type-body-small text-ink-soft leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="border-border rounded-[1rem] border bg-white p-6">
          <p className="type-title-small text-ink-strong mb-2 font-medium">
            Have a procurement question or need a custom contract?
          </p>
          <p className="type-body-small text-ink-soft mb-4 leading-relaxed">
            Email{" "}
            <a
              href="mailto:hello@rebuildingus.org"
              className="text-ink-strong hover:text-accent underline"
            >
              hello@rebuildingus.org
            </a>{" "}
            and we'll route you to someone who can help with annual invoicing, security review, or
            anything else your IT team needs.
          </p>
        </div>
      </section>
    </PageLayout>
  );
}
