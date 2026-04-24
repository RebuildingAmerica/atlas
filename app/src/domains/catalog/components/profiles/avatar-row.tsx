import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/platform/ui/badge";
import type { Entry } from "@/types";
import { ActorAvatar } from "./actor-avatar";

interface AvatarRowProps {
  people: Entry[];
  showHeader?: boolean;
}

function humanize(slug: string): string {
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstName(fullName: string): string {
  return fullName.split(/\s+/)[0] ?? fullName;
}

function firstSentence(text: string): string {
  const match = /^[^.!?]+[.!?]/.exec(text);
  return match ? match[0] : text;
}

interface PersonDetailPanelProps {
  person: Entry;
}

function PersonDetailPanel({ person }: PersonDetailPanelProps) {
  return (
    <div className="bg-surface-container-lowest mt-3 rounded-2xl p-4">
      <div className="flex items-start gap-4">
        <ActorAvatar name={person.name} type="person" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="type-title-small text-ink-strong font-semibold">{person.name}</p>
          {person.description ? (
            <p className="type-body-small text-ink-muted mt-0.5">
              {firstSentence(person.description)}
            </p>
          ) : null}
          <p className="type-label-small text-ink-muted mt-1">
            {person.source_count} {person.source_count === 1 ? "mention" : "mentions"}
          </p>
        </div>
      </div>

      {person.issue_areas.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {person.issue_areas.map((area) => (
            <span
              key={area}
              className="type-label-small bg-accent-soft text-accent-ink inline-block rounded-full px-2 py-0.5"
            >
              {humanize(area)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        <Link
          to="/entries/$entryId"
          params={{ entryId: person.id }}
          className="type-label-medium text-accent inline-flex items-center gap-1 font-medium hover:underline"
        >
          View full profile
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

export function AvatarRow({ people, showHeader = true }: AvatarRowProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (people.length === 0) return null;

  const selectedPerson = people[selectedIndex];
  if (!selectedPerson) return null;

  return (
    <div className="space-y-2">
      {showHeader ? (
        <div className="flex items-center gap-2">
          <p className="type-label-medium text-ink-muted">People</p>
          <Badge>{people.length}</Badge>
        </div>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-1">
        {people.map((person, index) => (
          <button
            key={person.id}
            type="button"
            onClick={() => {
              setSelectedIndex(index);
            }}
            className="flex flex-col items-center gap-1.5"
          >
            <div
              className={`rounded-full p-0.5 transition-all ${
                index === selectedIndex ? "bg-accent/18 shadow-sm" : "bg-surface-container-low"
              }`}
            >
              <ActorAvatar name={person.name} type="person" size="md" />
            </div>
            <span
              className={`type-label-small max-w-[56px] truncate ${
                index === selectedIndex ? "text-ink-strong" : "text-ink-muted"
              }`}
            >
              {firstName(person.name)}
            </span>
          </button>
        ))}
      </div>

      <PersonDetailPanel person={selectedPerson} />
    </div>
  );
}
