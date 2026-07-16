import { NotebookPen } from "lucide-react";
import { useState } from "react";
import { useAtlasSession } from "@/domains/access";
import {
  useCreateOrgAnnotation,
  useOrgAnnotations,
} from "@/domains/catalog/hooks/use-org-annotations";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";

type PrivateNoteTargetType = "entry" | "source";

interface PrivateNotesPanelProps {
  targetId: string;
  targetLabel: string;
  type: PrivateNoteTargetType;
}

function privateNoteBody(type: PrivateNoteTargetType, targetId: string, content: string) {
  if (type === "entry") {
    return { entry_id: targetId, content };
  }
  return { source_id: targetId, content };
}

export function PrivateNotesPanel({ targetId, targetLabel, type }: PrivateNotesPanelProps) {
  const session = useAtlasSession();
  const activeOrgId =
    session.data && !session.data.isLocal
      ? (session.data.workspace.activeOrganization?.id ?? null)
      : null;
  const annotations = useOrgAnnotations(
    activeOrgId,
    type === "entry" ? { entryId: targetId } : { sourceId: targetId },
    Boolean(activeOrgId),
  );
  const createAnnotation = useCreateOrgAnnotation();
  const [content, setContent] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!activeOrgId) {
    return null;
  }

  const trimmed = content.trim();
  const notes = annotations.data ?? [];

  async function handleSave() {
    if (!activeOrgId || !trimmed) {
      return;
    }
    setErrorMessage(null);
    try {
      await createAnnotation.mutateAsync({
        orgId: activeOrgId,
        body: privateNoteBody(type, targetId, trimmed),
      });
      setContent("");
    } catch {
      setErrorMessage("Could not save note.");
    }
  }

  return (
    <section
      aria-label={`Private notes for ${targetLabel}`}
      className="border-outline-variant bg-surface-container-lowest space-y-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <NotebookPen className="text-ink-muted h-4 w-4" aria-hidden />
          <p className="type-label-medium text-ink-strong">Private notes</p>
        </div>
        <Badge>{notes.length}</Badge>
      </div>

      {annotations.isLoading ? (
        <p className="type-body-small text-ink-muted">Loading...</p>
      ) : notes.length > 0 ? (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="type-body-small text-ink-soft bg-surface rounded-md p-3">
              {note.content}
            </li>
          ))}
        </ul>
      ) : (
        <p className="type-body-small text-ink-muted">No private notes yet.</p>
      )}

      <div className="space-y-2">
        <label htmlFor={`private-note-${type}-${targetId}`} className="sr-only">
          New note for {targetLabel}
        </label>
        <textarea
          id={`private-note-${type}-${targetId}`}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
          }}
          rows={3}
          placeholder="Add context for follow-up"
          className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface type-body-small w-full resize-y rounded-md border px-3 py-2 focus:ring-2 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={!trimmed || createAnnotation.isPending}
            className="type-label-small bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors disabled:opacity-60"
            aria-label={`Save note for ${targetLabel}`}
          >
            Save note
          </button>
          {errorMessage ? (
            <span className="type-label-small text-on-error-container" role="alert">
              {errorMessage}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
