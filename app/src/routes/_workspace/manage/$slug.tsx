import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Contact, FileText, Image, Save, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useManageProfile } from "@/domains/catalog/hooks/use-claims";
import { useEntryBySlug } from "@/domains/catalog/hooks/use-entries";
import { Badge } from "@/platform/ui/badge";
import { Button } from "@/platform/ui/button";
import { Select } from "@/platform/ui/select";
import type { Entry, Source } from "@/types";

export const Route = createFileRoute("/_workspace/manage/$slug")({
  component: ManageProfileRoute,
});

interface ManageFormState {
  customBio: string;
  photoUrl: string;
  preferredContactChannel: string;
  suppressedSourceIds: Set<string>;
}

function buildInitialState(entry: Entry): ManageFormState {
  return {
    customBio: entry.custom_bio ?? "",
    photoUrl: entry.photo_url ?? "",
    preferredContactChannel: entry.preferred_contact_channel ?? "",
    suppressedSourceIds: new Set<string>(),
  };
}

function ManageProfileRoute() {
  const { slug } = Route.useParams();
  const personQuery = useEntryBySlug("people", slug, { enabled: true });
  const orgQuery = useEntryBySlug("organizations", slug, {
    enabled: !personQuery.data && !personQuery.isLoading,
  });
  const entry = personQuery.data ?? orgQuery.data;
  const manageMutation = useManageProfile();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const initialState = useMemo<ManageFormState | null>(
    () => (entry ? buildInitialState(entry) : null),
    [entry],
  );
  const [form, setForm] = useState<ManageFormState | null>(initialState);

  useEffect(() => {
    if (initialState) {
      setForm(initialState);
    }
  }, [initialState]);

  if (!entry || !form) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <p className="type-body-medium text-ink-soft">Loading profile…</p>
      </div>
    );
  }

  const claimStatus = entry.claim.status;
  if (claimStatus !== "verified") {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-12">
        <h1 className="type-display-small text-ink-strong">This profile is not yours to manage</h1>
        <p className="type-body-medium text-ink-soft">
          Profile management is only available after a verified claim. Visit the{" "}
          <Link to="/claim/$slug" params={{ slug }} className="underline">
            claim flow
          </Link>{" "}
          to get verified.
        </p>
      </div>
    );
  }

  function toggleSuppressed(sourceId: string) {
    setForm((current) => {
      /* v8 ignore start -- the suppression checkbox only renders once the form is initialised */
      if (!current) return current;
      /* v8 ignore stop */
      const next = new Set(current.suppressedSourceIds);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return { ...current, suppressedSourceIds: next };
    });
  }

  async function handleSave() {
    /* v8 ignore start -- the Save button only renders when the form and entry are both initialised */
    if (!form || !entry) return;
    /* v8 ignore stop */
    setErrorMessage(null);
    setSavedMessage(null);
    try {
      const trimmedBio = form.customBio.trim();
      const trimmedPhoto = form.photoUrl.trim();
      await manageMutation.mutateAsync({
        slug: entry.slug,
        body: {
          custom_bio: trimmedBio || undefined,
          photo_url: trimmedPhoto || undefined,
          preferred_contact_channel: form.preferredContactChannel.trim() || undefined,
          suppressed_source_ids: Array.from(form.suppressedSourceIds),
          clear_photo: !trimmedPhoto,
          clear_custom_bio: !trimmedBio,
        },
      });
      setSavedMessage("Saved.");
      window.setTimeout(() => {
        setSavedMessage(null);
      }, 3000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not save changes.");
    }
  }

  const sources = entry.sources ?? [];
  const profilePath = `/profiles/${entry.type === "organization" ? "organizations" : "people"}/${entry.slug}`;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-12">
      <Link
        to={profilePath as "/profiles"}
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to public profile
      </Link>

      <div className="space-y-3">
        <Badge variant="success">Verified subject</Badge>
        <h1 className="type-display-small text-ink-strong">Manage {entry.name}</h1>
        <p className="type-body-large text-ink-soft">
          Choose the details people see first, how they should reach you, and which sources belong
          in reviewer context.
        </p>
      </div>

      <FormSection
        title="Public profile fields"
        description="These details appear on the public profile after you save them."
      >
        <div className="grid gap-5">
          <ProfileField icon={FileText} label="Bio">
            <textarea
              rows={4}
              value={form.customBio}
              onChange={(event) => {
                setForm((current) => current && { ...current, customBio: event.target.value });
              }}
              className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
              placeholder="Write a short bio shown on the public profile."
            />
            <p className="type-label-small text-ink-muted">
              Leave blank to use the sourced description.
            </p>
          </ProfileField>

          <ProfileField icon={Image} label="Photo URL">
            <input
              type="url"
              value={form.photoUrl}
              onChange={(event) => {
                setForm((current) => current && { ...current, photoUrl: event.target.value });
              }}
              className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
              placeholder="https://your-domain.example/your-photo.jpg"
            />
            <p className="type-label-small text-ink-muted">
              Paste a public image URL. Leave blank to use initials.
            </p>
          </ProfileField>

          <ProfileField icon={Contact} label="Preferred contact">
            <Select
              ariaLabel="Preferred contact channel"
              icon={Contact}
              value={form.preferredContactChannel}
              onChange={(preferredContactChannel) => {
                setForm((current) => current && { ...current, preferredContactChannel });
              }}
              options={[
                { value: "", label: "No preference" },
                { value: "email", label: "Email" },
                { value: "form", label: "Contact form" },
                { value: "external", label: "External link" },
              ]}
              size="compact"
            />
          </ProfileField>
        </div>
      </FormSection>

      <FormSection
        title="Source visibility"
        description="Checked sources stay out of the public profile."
      >
        <div className="border-outline-variant bg-surface-container-lowest inline-flex items-center gap-2 rounded-full border px-3 py-1.5">
          <ShieldCheck className="text-ink-muted h-4 w-4" aria-hidden />
          <span className="type-label-medium text-ink-strong">Private to Atlas reviewers</span>
        </div>
        <p className="type-body-medium text-ink-soft">
          Use this for outdated, sensitive, or misleading sources. Public trust still depends on
          visible evidence, so hide only what should not be shown.
        </p>
        {sources.length === 0 ? (
          <p className="type-body-small text-ink-muted">No sources listed yet.</p>
        ) : (
          <ul className="space-y-2">
            {sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                checked={form.suppressedSourceIds.has(source.id)}
                onToggle={() => {
                  toggleSuppressed(source.id);
                }}
              />
            ))}
          </ul>
        )}
      </FormSection>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            void handleSave();
          }}
          disabled={manageMutation.isPending}
        >
          <span className="inline-flex items-center gap-2">
            <Save className="h-4 w-4" aria-hidden />
            {manageMutation.isPending ? "Saving…" : "Save changes"}
          </span>
        </Button>
        {savedMessage ? (
          <span className="type-label-medium text-emerald-700" role="status">
            {savedMessage}
          </span>
        ) : null}
        {errorMessage ? (
          <span className="type-label-medium text-rose-700" role="alert">
            {errorMessage}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <section className="bg-surface-container space-y-3 rounded-[1rem] p-5">
      <h2 className="type-title-medium text-ink-strong">{title}</h2>
      {description ? <p className="type-body-medium text-ink-soft">{description}</p> : null}
      {children}
    </section>
  );
}

interface ProfileFieldProps {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}

function ProfileField({ icon: Icon, label, children }: ProfileFieldProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Icon className="text-ink-muted h-4 w-4" aria-hidden />
        <p className="type-label-medium text-ink-strong">{label}</p>
      </div>
      {children}
    </div>
  );
}

function SourceRow({
  source,
  checked,
  onToggle,
}: {
  source: Source;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="bg-surface-container-lowest border-outline-variant flex items-start gap-3 rounded-lg border p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 h-4 w-4"
        aria-label={`Suppress ${source.title ?? source.url}`}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="type-body-medium text-ink-strong block truncate hover:underline"
        >
          {source.title ?? source.url}
        </a>
        <p className="type-label-small text-ink-muted">
          {source.publication ?? "Unknown publication"} · {source.published_date ?? "no date"}
        </p>
      </div>
    </li>
  );
}
