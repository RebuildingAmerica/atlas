import { PolicyPage } from "./policy-page";

const TERMS_SECTIONS = [
  {
    title: "About Atlas",
    paragraphs: [
      "Atlas is a source-linked civic directory and research product operated by Rebuilding America Project. These Terms of Service govern your use of the Atlas website, public directory, and account-based features.",
      "By using Atlas, you agree to these terms. If you do not agree, do not use the service.",
    ],
  },
  {
    title: "Acceptable use",
    paragraphs: [
      "You may use Atlas for lawful research, discovery, and organizational work. You may not use Atlas to break the law, interfere with the service, or misuse data about other people.",
    ],
    bullets: [
      "Do not attempt unauthorized access to Atlas systems or other user accounts.",
      "Do not scrape, overload, or disrupt Atlas in a way that harms availability for others.",
      "Do not use Atlas to harass, stalk, exploit, or target people with harmful conduct.",
      "Do not misrepresent Atlas data as guaranteed complete, current, or error-free.",
    ],
  },
  {
    title: "Public directory content",
    paragraphs: [
      "Atlas includes records compiled from public sources. We work to trace records to source material, but we do not guarantee that every listing is complete, current, or appropriate for every purpose.",
      "If you submit corrections, flags, or feedback, you give us permission to review and use that input to improve the directory.",
    ],
  },
  {
    title: "Accounts, subscriptions, and access",
    paragraphs: [
      "Some Atlas features require an account or paid access. You are responsible for keeping your login credentials secure and for activity that occurs under your account.",
      "Paid products, billing cycles, and access levels are described at checkout or on pricing pages. Access may be suspended or terminated if fees remain unpaid or if these terms are violated.",
    ],
  },
  {
    title: "Automatic renewal",
    paragraphs: [
      "Atlas Pro and Atlas Team are subscriptions that renew automatically until you cancel. Atlas Pro renews every month or every year, and the student option renews every four months. Atlas Team renews every month or every year, and per-seat charges renew on the same schedule. The Atlas Research Pass is a single charge that does not renew.",
      "Each renewal is charged to the payment method on file at the price shown at checkout, plus any applicable tax. We will tell you before a price change takes effect on your subscription.",
      "You can cancel at any time from the billing portal in your workspace settings. Cancelling stops the next renewal and keeps your access until the end of the period you have already paid for. We do not cancel a subscription on your behalf when you simply stop using Atlas.",
    ],
  },
  {
    title: "Refunds",
    paragraphs: [
      "If Atlas charged you for something you did not intend to buy, or a renewal took you by surprise, write to hello@rebuildingus.org within 30 days of the charge and we will refund it. We would rather return the money than keep a subscription somebody did not want.",
      "If Atlas is substantially unavailable for a sustained period during a term you paid for, tell us and we will refund or credit that term.",
      "Refunds return to the original payment method. Refunding a term ends the paid access it covered.",
    ],
  },
  {
    title: "Failed payments",
    paragraphs: [
      "When a renewal payment fails, Stripe retries it for a period and your paid features stay available while it does. If payment does not recover, paid features stop and the workspace returns to the free tier. Your notes, shortlists, and other saved work remain readable.",
    ],
  },
  {
    title: "Availability and changes",
    paragraphs: [
      "Atlas may evolve over time. We may add, remove, or change features, pricing, and policies as the product develops.",
      'We try to keep Atlas available and accurate, but the service is provided on an "as is" and "as available" basis without warranties of uninterrupted service, fitness for a particular purpose, or complete accuracy.',
    ],
  },
  {
    title: "Contact",
    paragraphs: ["Questions about these terms can be sent to hello@rebuildingus.org."],
  },
] satisfies Parameters<typeof PolicyPage>[0]["sections"];

export function TermsPage() {
  return (
    <PolicyPage
      title="Terms of Service"
      summary="These terms explain the basic rules for using Atlas, including acceptable use, public-directory limitations, account responsibilities, how paid access works, when subscriptions renew, and how to get a refund."
      lastUpdated="September 8, 2026"
      sections={TERMS_SECTIONS}
    />
  );
}
