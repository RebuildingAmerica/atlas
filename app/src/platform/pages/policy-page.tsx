import { PageLayout } from "@/platform/layout/page-layout";

interface PolicySection {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

interface PolicyPageProps {
  title: string;
  summary: string;
  lastUpdated: string;
  sections: PolicySection[];
}

export function PolicyPage({ title, summary, lastUpdated, sections }: PolicyPageProps) {
  return (
    <PageLayout className="py-10 lg:py-16">
      <div className="mx-auto w-full max-w-4xl space-y-10">
        <header className="space-y-4">
          <div className="space-y-3">
            <h1 className="type-display-small text-ink-strong">{title}</h1>
            <p className="type-body-large text-ink-soft max-w-3xl">{summary}</p>
          </div>
          <div className="border-border bg-surface-container-low rounded-[1.4rem] border px-5 py-4">
            <p className="type-body-small text-ink-soft">
              <strong className="text-ink-strong">Last updated:</strong> {lastUpdated}
            </p>
          </div>
        </header>

        <div className="space-y-8">
          {sections.map((section) => (
            <section key={section.title} className="space-y-3">
              <h2 className="type-title-large text-ink-strong">{section.title}</h2>
              <div className="space-y-3">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="type-body-large text-ink-soft">
                    {paragraph}
                  </p>
                ))}
              </div>
              {section.bullets && section.bullets.length > 0 ? (
                <ul className="space-y-2 pl-5">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="type-body-large text-ink-soft">
                      {bullet}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
