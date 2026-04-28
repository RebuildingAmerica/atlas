import { PolicyPage } from "./policy-page";

const PRIVACY_SECTIONS = [
  {
    title: "Who this policy covers",
    paragraphs: [
      "This Privacy Policy applies to Atlas, the public directory and research software operated by Rebuilding America Project.",
      "It explains what information we collect when you browse the public site, create an account, use paid workspace features, or contact us.",
    ],
  },
  {
    title: "Information we collect",
    paragraphs: [
      "We collect the information needed to operate Atlas. That can include account details such as your name, email address, organization details, and authentication data when you sign in.",
      "If you purchase Atlas access, our payment processors may provide us with limited billing and subscription information needed to manage your account. We do not store full payment card numbers on Atlas systems.",
      "We also collect basic product and operational data such as requests, device or browser metadata, error logs, and usage events needed to keep the service available and improve it.",
    ],
  },
  {
    title: "Public-source data in Atlas",
    paragraphs: [
      "Atlas also stores and displays information about people, organizations, initiatives, and sources gathered from public materials. That public-source information is treated differently from private account data.",
      "We use public-source information to build a source-linked civic directory. If you believe a listing is inaccurate, outdated, or should be reviewed, contact us and we will assess the request.",
    ],
  },
  {
    title: "How we use information",
    paragraphs: [
      "We use collected information to operate the service, secure accounts, process subscriptions, support users, investigate abuse, improve Atlas, and maintain the quality of the public directory.",
    ],
    bullets: [
      "To provide and maintain Atlas features",
      "To authenticate users and manage access",
      "To process billing and administer subscriptions",
      "To detect outages, fraud, misuse, and security issues",
      "To review, improve, and correct public directory records",
    ],
  },
  {
    title: "How information is shared",
    paragraphs: [
      "We share information only when needed to run Atlas, comply with the law, protect the service, or complete transactions you request. This can include infrastructure providers, authentication providers, analytics/status providers, and payment processors.",
      "We do not sell personal information collected through Atlas.",
    ],
  },
  {
    title: "Your choices and contact",
    paragraphs: [
      "You can contact us to request account help, raise privacy concerns, or report issues with a public listing. We may need to keep certain records where required for legal, security, billing, or operational reasons.",
      "For privacy questions, contact hello@rebuildingus.org.",
    ],
  },
] satisfies Parameters<typeof PolicyPage>[0]["sections"];

export function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy Policy"
      summary="Atlas collects only the information needed to operate the service, secure accounts, process subscriptions, and maintain a source-linked public directory."
      lastUpdated="April 23, 2026"
      sections={PRIVACY_SECTIONS}
    />
  );
}
