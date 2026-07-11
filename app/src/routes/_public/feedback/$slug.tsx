import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, MessageSquareWarning, Send, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { loadEntryBySlugAny } from "@/domains/catalog/server/profiles/profile-loaders";
import { createEntityFlag } from "@/lib/generated/atlas";
import { PageLayout } from "@/platform/layout/page-layout";
import { buildPageHead } from "@/platform/seo";
import { Button } from "@/platform/ui/button";

const feedbackKindSchema = z.enum(["incorrect", "missing_context", "representation"]);

const feedbackSearchSchema = z.object({
  kind: feedbackKindSchema.default("incorrect"),
});

type FeedbackKind = z.infer<typeof feedbackKindSchema>;

interface FeedbackOption {
  value: FeedbackKind;
  label: string;
  reason: string;
}

const FEEDBACK_OPTIONS: FeedbackOption[] = [
  {
    value: "incorrect",
    label: "Stale or incorrect information",
    reason: "incorrect",
  },
  {
    value: "missing_context",
    label: "Missing context",
    reason: "missing_context",
  },
  {
    value: "representation",
    label: "Representation concern",
    reason: "representation",
  },
];

export const Route = createFileRoute("/_public/feedback/$slug")({
  validateSearch: feedbackSearchSchema,
  loader: async ({ params }) => {
    const entry = await loadEntryBySlugAny({ data: { slug: params.slug } });
    return { entry };
  },
  head: ({ loaderData }) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    return buildPageHead({
      title: `Improve ${entry.name} | Atlas`,
      description: `Submit source-linked corrections or missing context for ${entry.name}.`,
      path: `/feedback/${entry.slug}`,
      noindex: true,
    });
  },
  component: FeedbackRoute,
});

function buildFeedbackNote(note: string, contactEmail: string): string {
  const trimmedNote = note.trim();
  const trimmedContact = contactEmail.trim();
  if (!trimmedContact) return trimmedNote;
  return `${trimmedNote}\n\nContact: ${trimmedContact}`;
}

function getFeedbackOption(kind: FeedbackKind): FeedbackOption {
  const option = FEEDBACK_OPTIONS.find((item) => item.value === kind);
  if (!option) {
    throw new Error(`Unsupported feedback kind: ${kind}`);
  }
  return option;
}

function FeedbackRoute() {
  const { entry } = Route.useLoaderData();
  const search = Route.useSearch();
  const [kind, setKind] = useState<FeedbackKind>(search.kind);
  const [note, setNote] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const profilePath = `/profiles/${entry.type === "organization" ? "organizations" : "people"}/${entry.slug}`;
  const selectedOption = getFeedbackOption(kind);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNote = note.trim();
    if (!trimmedNote) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSubmitted(false);
    try {
      await createEntityFlag({
        entity_id: entry.id,
        reason: selectedOption.reason,
        note: buildFeedbackNote(trimmedNote, contactEmail),
      });
      setSubmitted(true);
      setNote("");
      setContactEmail("");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not submit feedback.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PageLayout className="pt-0 pb-12">
      <div className="bg-ink-strong/10 -mx-4 min-h-[calc(100vh-8rem)] px-4 py-8">
        <section
          role="dialog"
          aria-label="Record review"
          className="border-border-strong bg-surface mx-auto max-w-xl space-y-6 rounded-[1rem] border p-6 shadow-xl"
        >
          <Link
            to={profilePath as "/profiles"}
            aria-label="Close record review"
            className="border-border text-ink-soft hover:text-ink-strong hover:bg-surface-container-high ml-auto flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
          >
            <X className="h-4 w-4" aria-hidden />
          </Link>

          <div className="space-y-3">
            <p className="type-label-small text-ink-muted uppercase">Record review</p>
            <h1 className="type-headline-small text-ink-strong">Review {entry.name}</h1>
            <p className="type-body-large text-ink-soft">
              Send a correction, stale detail, or missing context.
            </p>
          </div>

          <form
            className="space-y-5"
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <fieldset className="space-y-3">
              <legend className="type-title-small text-ink-strong">What needs review?</legend>
              <div className="grid gap-2">
                {FEEDBACK_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="border-outline-variant bg-surface-container-lowest flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={option.value}
                      checked={kind === option.value}
                      onChange={() => {
                        setKind(option.value);
                      }}
                      className="h-4 w-4"
                    />
                    <span className="type-body-medium text-ink-strong">{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="grid gap-2">
              <span className="type-label-medium text-ink-strong">What should be reviewed?</span>
              <textarea
                className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface min-h-32 w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                placeholder="Share the specific detail, source link, or missing context."
                required
              />
            </label>

            <label className="grid gap-2">
              <span className="type-label-medium text-ink-strong">Contact email, optional</span>
              <input
                type="email"
                className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
                value={contactEmail}
                onChange={(event) => {
                  setContactEmail(event.target.value);
                }}
                placeholder="name@example.org"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isSubmitting || !note.trim()}>
                <Send className="mr-2 inline h-4 w-4" aria-hidden />
                {isSubmitting ? "Submitting..." : "Submit for review"}
              </Button>
              {submitted ? (
                <span
                  role="status"
                  className="type-label-medium text-on-success-container inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Received for review.
                </span>
              ) : null}
              {errorMessage ? (
                <span
                  role="alert"
                  className="type-label-medium text-on-error-container inline-flex items-center gap-1.5"
                >
                  <MessageSquareWarning className="h-4 w-4" aria-hidden />
                  {errorMessage}
                </span>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </PageLayout>
  );
}
