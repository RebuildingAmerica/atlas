import { PolicyPage } from "./policy-page";

const SECURITY_SECTIONS = [
  {
    title: "Our approach",
    paragraphs: [
      "Atlas is built to minimize unnecessary data collection, protect account access, and make operational issues visible quickly. We use modern hosted infrastructure, authenticated access for private workspace features, and routine quality checks in development.",
      "No internet-connected service can promise perfect security, but we work to reduce risk and respond quickly when issues are identified.",
    ],
  },
  {
    title: "Account and product safeguards",
    paragraphs: [
      "We use access controls, authentication workflows, and environment-based secrets management to protect non-public Atlas systems. We also monitor service health and maintain internal development checks before changes are shipped.",
    ],
    bullets: [
      "Authenticated access for account and workspace features",
      "Payment handling through external payment processors",
      "Operational monitoring and status visibility",
      "Code quality, linting, type-checking, and test gates in development",
    ],
  },
  {
    title: "Responsible disclosure",
    paragraphs: [
      "If you believe you found a security issue in Atlas, please report it privately before disclosing it publicly. Include enough detail for us to reproduce and investigate the issue.",
      "Do not use a discovered issue to access data that is not yours, disrupt the service, or degrade availability for others.",
    ],
  },
  {
    title: "How to report a security issue",
    paragraphs: [
      'Please send security reports to hello@rebuildingamerica.us with the subject line "Atlas security report." We will review the report, investigate, and follow up as appropriate.',
      "If the issue affects a live incident or service outage, we may also post status updates through our public status page.",
    ],
  },
  {
    title: "Security limitations",
    paragraphs: [
      "Atlas includes information gathered from public sources, open web materials, and user account activity. You should avoid sending sensitive secrets, regulated data, or information you do not want stored in Atlas unless we have explicitly agreed to support that use case.",
    ],
  },
] satisfies Parameters<typeof PolicyPage>[0]["sections"];

export function SecurityPage() {
  return (
    <PolicyPage
      eyebrow="Security"
      title="Security"
      summary="Atlas is operated with a practical security posture focused on account protection, limited data collection, responsible disclosure, and transparent incident communication."
      lastUpdated="April 23, 2026"
      sections={SECURITY_SECTIONS}
    />
  );
}
