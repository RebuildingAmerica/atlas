import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Contact, FileText, Image, Save, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAtprotoIdentities } from "@/domains/access/atproto-identities";
import {
  useAttachProfileAtprotoIdentity,
  useDetachProfileAtprotoIdentity,
  useManageProfile,
} from "@/domains/catalog/hooks/use-claims";
import { useEntryBySlug } from "@/domains/catalog/hooks/use-entries";
import { Badge } from "@/platform/ui/badge";
import { Button } from "@/platform/ui/button";
import { useConfirmDialog } from "@/platform/ui/confirm-dialog";
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
  const identities = useAtprotoIdentities();
  const attachIdentity = useAttachProfileAtprotoIdentity();
  const detachIdentity = useDetachProfileAtprotoIdentity();
  const { confirm } = useConfirmDialog();
  const [selectedIdentityId, setSelectedIdentityId] = useState(
    () =>
      (typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("atprotoIdentityId")) ?? "",
  );
  const [connectHandle, setConnectHandle] = useState("");
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
          Profile management is available after verification. Visit the{" "}
          <Link to="/claim/$slug" params={{ slug }} className="underline">
            verification page
          </Link>{" "}
          to continue.
        </p>
      </div>
    );
  }
  const managedEntry = entry;

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

  async function handleAttachIdentity() {
    if (!selectedIdentityId) return;
    setErrorMessage(null);
    const selected = identities.data?.find((identity) => identity.id === selectedIdentityId);
    const replacing = Boolean(
      managedEntry.claim.linked_atproto_handle &&
      selected &&
      managedEntry.claim.linked_atproto_handle !== selected.current_handle,
    );
    if (replacing) {
      const accepted = await confirm({
        title: "Replace public identity?",
        body: `Replace ${managedEntry.claim.linked_atproto_handle} with ${selected?.current_handle}?`,
        confirmLabel: "Replace",
      });
      if (!accepted) return;
    }
    try {
      await attachIdentity.mutateAsync({
        slug: managedEntry.slug,
        body: { atproto_identity_id: selectedIdentityId, replace: replacing },
      });
      setSavedMessage("Public identity updated.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not update public identity.");
    }
  }

  async function handleRemoveIdentity() {
    const accepted = await confirm({
      title: "Remove public identity?",
      body: "The ATProto account stays connected to your Atlas account.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!accepted) return;
    try {
      await detachIdentity.mutateAsync(managedEntry.slug);
      setSelectedIdentityId("");
      setSavedMessage("Public identity removed.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not remove public identity.");
    }
  }

  function connectAnotherIdentity() {
    const handle = connectHandle.trim();
    if (!handle) return;
    const startUrl = new URL("/api/atproto/oauth/start", window.location.origin);
    startUrl.searchParams.set("handle", handle);
    startUrl.searchParams.set("returnTo", `/manage/${managedEntry.slug}`);
    window.location.assign(startUrl.toString());
  }

  const sources = entry.sources ?? [];
  const profilePath = `/profiles/${entry.type === "organization" ? "organizations" : "people"}/${entry.slug}`;
  const verificationBadge =
    entry.type === "organization" ? "Verified representative" : "Verified person";

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
        <Badge variant="success">{verificationBadge}</Badge>
        <h1 className="type-display-small text-ink-strong">Manage {entry.name}</h1>
        <p className="type-body-large text-ink-soft">
          Choose the details people see first, how they should reach you, and which sources belong
          in reviewer context.
        </p>
      </div>

      <FormSection
        title="Profile details"
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
        title="Public identity"
        description="Choose the verified ATProto identity shown on this public profile."
      >
        {entry.claim.linked_atproto_handle ? (
          <p className="type-body-medium text-ink-soft">
            Current identity: {entry.claim.linked_atproto_handle}
          </p>
        ) : null}
        <label className="type-label-medium text-ink-strong grid gap-2">
          ATProto identity
          <select
            value={selectedIdentityId}
            onChange={(event) => {
              setSelectedIdentityId(event.target.value);
            }}
            className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          >
            <option value="">Choose an identity</option>
            {identities.data
              ?.filter(
                (identity) =>
                  identity.control_status === "active" && identity.resolution_status === "verified",
              )
              .map((identity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.current_handle}
                </option>
              ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!selectedIdentityId || attachIdentity.isPending}
            onClick={() => {
              void handleAttachIdentity();
            }}
          >
            {entry.claim.linked_atproto_handle ? "Replace identity" : "Attach identity"}
          </Button>
          {entry.claim.linked_atproto_handle ? (
            <Button
              disabled={detachIdentity.isPending}
              variant="ghost"
              onClick={() => {
                void handleRemoveIdentity();
              }}
            >
              Remove identity
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="Another ATProto handle"
            value={connectHandle}
            onChange={(event) => {
              setConnectHandle(event.target.value);
            }}
            className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          />
          <Button
            variant="secondary"
            disabled={!connectHandle.trim()}
            onClick={connectAnotherIdentity}
          >
            Connect another account
          </Button>
        </div>
      </FormSection>

      <FormSection
        title="Public sources"
        description="Hide sources that should stay with reviewer notes."
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
