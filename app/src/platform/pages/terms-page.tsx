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
      eyebrow="Terms"
      title="Terms of Service"
      summary="These terms explain the basic rules for using Atlas, including acceptable use, public-directory limitations, account responsibilities, and how paid access works."
      lastUpdated="April 23, 2026"
      sections={TERMS_SECTIONS}
    />
  );
}
