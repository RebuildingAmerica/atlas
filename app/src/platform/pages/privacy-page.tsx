import { PolicyPage } from "./policy-page";

const PRIVACY_SECTIONS = [
  {
    title: "Who this policy covers",
    paragraphs: [
      "This Privacy Policy applies to Atlas, the public directory and research software operated by Rebuilding America Project.",
      "It explains what information we collect when you browse the public site, create an account, use paid workspace features, or contact us. It also explains how we handle information about the people and organizations listed in the directory, who are not our users and did not sign up for anything.",
    ],
  },
  {
    title: "Information we collect",
    paragraphs: [
      "We collect the information needed to operate Atlas. That can include account details such as your name, email address, organization details, and authentication data when you sign in.",
      "Signing in may involve a passkey, a magic link sent to your email, your employer's single sign-on provider, or an ATProto identity. Each of those records what is needed to recognize you on your next visit. Workspaces on Atlas Team may provision and deprovision members through SCIM, which sends us the member names, email addresses, and status changes your identity provider chooses to send.",
      "If you purchase Atlas access, our payment processor gives us limited billing and subscription information needed to manage your account, such as the plan, the status, and the last four digits of the card. We never receive or store full payment card numbers.",
      "We also collect basic product and operational data such as requests, device or browser metadata, error logs, and usage events needed to keep the service available and improve it.",
    ],
  },
  {
    title: "Public-source data in Atlas",
    paragraphs: [
      "Atlas stores and displays information about people, organizations, initiatives, and sources gathered from public materials. That public-source information is treated differently from private account data, and most of the people it describes are not Atlas users.",
      "We publish this information because civic work is easier to trust when it can be traced. Every record links to the public sources it came from, so a reader can check the evidence rather than take our word for it. We do not publish home addresses, personal phone numbers, personal email addresses, or information about anyone we can identify as a minor.",
      "If you are described in Atlas and something is wrong, outdated, or should not be there at all, see 'If Atlas lists you' below. You do not need an account to ask.",
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
    title: "Service providers we rely on",
    paragraphs: [
      "Running Atlas means handing parts of the job to other companies. Each one below sees only what its part of the job requires, and each is bound by its own contract with us to process that information on our instructions. We do not sell personal information collected through Atlas, and we do not share it for advertising.",
    ],
    bullets: [
      "Vercel — hosts the Atlas application and serves every page request (United States)",
      "Google Cloud — runs the Atlas API and the identity server (United States)",
      "Neon — hosts the PostgreSQL database holding accounts, workspaces, and directory records (United States)",
      "Cloudflare — routes and protects traffic to atlas.rebuildingus.org (global edge network)",
      "Stripe — processes payments, subscriptions, and tax calculation (United States)",
      "Resend — delivers sign-in links, invitations, and account email (United States)",
      "Anthropic — reads public web pages Atlas has fetched and extracts structured records from them; account data is not sent (United States)",
      "Brave Search — receives discovery search queries, which describe places and civic topics rather than people who use Atlas (United States)",
    ],
  },
  {
    title: "Where information is processed",
    paragraphs: [
      "Atlas is operated from the United States, and the providers above process information there. If you use Atlas from outside the United States, your information is transferred to and stored in the United States, which may have different privacy protections than your own country.",
    ],
  },
  {
    title: "How long we keep information",
    paragraphs: [
      "Account information stays while your account is open. If you delete your account, we remove your profile, sessions, and workspace membership within 30 days, except where we must keep something longer.",
      "We keep billing and tax records for seven years because tax law requires it. We keep security and request logs for 90 days. Directory records are kept indefinitely, because a directory that forgets is not a directory, subject to the removal process below.",
    ],
  },
  {
    title: "Your rights over your account data",
    paragraphs: [
      "You can ask us for a copy of the personal information we hold about you, ask us to correct it, ask us to delete it, or ask us to stop processing it. Depending on where you live, some of these are legal rights and others are simply things we will do.",
      'Write to hello@rebuildingus.org with the subject line "Atlas privacy request," from the email address on the account, or from another address if you can otherwise show the account is yours. We answer within 30 days. If a request is complex enough to need longer, we will tell you why before that deadline passes. We do not charge for this, and we will not treat you differently for asking.',
      "Two of these need no email at all. You can cancel a subscription yourself from the billing portal in your workspace settings, and paid plans can download lists and briefs as CSV or JSON from the page they live on. Ask us if you want a copy of everything at once.",
    ],
  },
  {
    title: "If Atlas lists you",
    paragraphs: [
      "The directory describes people who never signed up for it, so the process for those people is deliberately easier than the one above. Write to hello@rebuildingus.org with a link to the record. You do not need an account, and you do not need to prove who you are unless the request would remove information about somebody else.",
      "We will correct anything inaccurate. We will remove a record when the person is a private individual rather than a public figure acting in a public role, when the sources no longer support what the record says, or when publication would put someone at risk of harm. Tell us if that last one applies and we will act on it before we finish arguing about the rest.",
      "We will keep a record published, and say so, when it describes a public official or a public organizational role and the sources still support it. That is the point of a civic directory, and it is the one case where we may say no.",
    ],
  },
  {
    title: "Security",
    paragraphs: [
      "Atlas encrypts traffic in transit and data at rest, scopes API keys to the permissions they need, and supports passkeys so an account need not depend on a password at all.",
      "No system is perfect. If we discover a breach affecting your personal information, we will tell you and the relevant regulator as the law requires. To report a vulnerability, see our security page.",
    ],
  },
  {
    title: "Children",
    paragraphs: [
      "Atlas is not for children. We do not knowingly collect personal information from anyone under 13, and we do not knowingly publish directory records about minors. If you believe we have either, write to hello@rebuildingus.org and we will remove it.",
    ],
  },
  {
    title: "Changes to this policy",
    paragraphs: [
      "We will update this policy as Atlas changes, and the date at the top always says when. If a change materially reduces your privacy, we will email account holders before it takes effect rather than quietly reposting the page.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      'For privacy questions, requests about your own data, or a listing you want reviewed, write to hello@rebuildingus.org with "Atlas privacy request" in the subject line.',
    ],
  },
] satisfies Parameters<typeof PolicyPage>[0]["sections"];

export function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy Policy"
      summary="Atlas collects only the information needed to operate the service, secure accounts, process subscriptions, and maintain a source-linked public directory. This policy names every company that processes that information, says how long we keep it, and explains how to get your data or a directory listing changed."
      lastUpdated="September 9, 2026"
      sections={PRIVACY_SECTIONS}
    />
  );
}
