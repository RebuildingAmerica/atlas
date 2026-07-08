import { Bell, BookOpen, FileText, Search, type LucideIcon } from "lucide-react";
import type { Entry, EntryType } from "@/types";

interface SearchExample {
  query: string;
  result: string;
}

interface FieldActor {
  name: string;
  role: string;
  connections: string;
}

interface BriefActor {
  name: string;
  type: string;
  note: string;
  sources: number | "manual";
}

interface FeatureWorkflow {
  name: string;
  description: string;
  Icon: LucideIcon;
}

interface IssueTile {
  count: string;
  description?: string;
  imageUrl?: string;
  label: string;
}

export const ISSUE_CHIPS = [
  "Housing",
  "Climate",
  "Criminal Justice",
  "Education",
  "Voting Rights",
  "Immigration",
] as const;

export const SEARCH_EXAMPLES: SearchExample[] = [
  { query: "tenant organizers · Detroit, MI", result: "34 actors" },
  { query: "voting rights · Georgia", result: "218 actors" },
  { query: "climate policy · Gulf Coast", result: "91 actors" },
  { query: "criminal justice reform · Texas", result: "174 actors" },
  { query: "housing advocates · Phoenix, AZ", result: "56 actors" },
];

export const FIELD_ACTORS: FieldActor[] = [
  { name: "María Martínez", role: "Community organizer", connections: "4 connections" },
  {
    name: "Detroit Housing Coalition",
    role: "Organization · 8 staff indexed",
    connections: "12 connections",
  },
  {
    name: "Coalition for Property Tax Justice",
    role: "Coalition · 6 member orgs",
    connections: "7 connections",
  },
  {
    name: "Legal Aid & Defender Assoc.",
    role: "Organization · housing unit",
    connections: "3 connections",
  },
];

export const FEATURE_WORKFLOWS: FeatureWorkflow[] = [
  {
    description: "Start with a place and problem, not a complicated research form.",
    Icon: Search,
    name: "Name the need",
  },
  {
    description: "See the people and organizations most relevant to the work ahead.",
    Icon: FileText,
    name: "Find the right people",
  },
  {
    description: "Know when the public record is thin before you rely on it.",
    Icon: Bell,
    name: "See what is missing",
  },
  {
    description: "Leave with a short list you can bring to a meeting or share with a team.",
    Icon: BookOpen,
    name: "Take it with you",
  },
];

export const BRIEF_ACTORS: BriefActor[] = [
  {
    name: "María Martínez",
    note: "Avery is confirming meeting details before outreach.",
    sources: 8,
    type: "Assigned · follow-up",
  },
  {
    name: "Detroit Housing Coalition",
    note: "Shared note added for partner briefing.",
    sources: 12,
    type: "Reviewed",
  },
  {
    name: "Coalition for Property Tax Justice",
    note: "Coverage gap flagged for staff research.",
    sources: 4,
    type: "Needs review",
  },
  {
    name: "Legal Aid & Defender Assoc.",
    note: "Exported to county hearing packet.",
    sources: 5,
    type: "Exported",
  },
  {
    name: "James Whitfield",
    note: "Manual lead, visible only to this workspace.",
    sources: "manual",
    type: "Private note",
  },
  {
    name: "Wayne Co. Housing Commission",
    note: "Morgan assigned public-record refresh.",
    sources: 7,
    type: "Assigned · refresh",
  },
];

export const ISSUE_TILES: IssueTile[] = [
  {
    count: "5,103 actors",
    description: "From early childhood to higher ed, the largest cluster of civic work in Atlas.",
    imageUrl:
      "https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1200&q=80",
    label: "Education Equity",
  },
  {
    count: "4,667 actors",
    description:
      "Organizing, litigation, and policy documented across every region of the country.",
    imageUrl:
      "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=1200&q=80",
    label: "Racial Justice",
  },
  { count: "4,220 actors", label: "Climate & Environment" },
  { count: "3,812 actors", label: "Housing & Homelessness" },
  { count: "3,488 actors", label: "Economic Justice" },
  { count: "2,940 actors", label: "Criminal Justice Reform" },
  { count: "2,715 actors", label: "Healthcare Access" },
  { count: "2,341 actors", label: "Immigration" },
];

export const TYPE_LABELS: Record<EntryType, string> = {
  campaign: "campaign",
  event: "event",
  initiative: "initiative",
  organization: "org",
  person: "person",
};

export const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

export function formatStatCount(value: number | undefined): string {
  if (value === undefined || value <= 0) {
    return "";
  }

  return NUMBER_FORMATTER.format(value);
}

export function browseUrl(query: string): string {
  return `/browse?query=${encodeURIComponent(query)}&offset=0`;
}

export function humanizeIssue(value: string | undefined): string {
  if (!value) {
    return "Unlisted";
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatLocation(entry: Entry): string {
  return [entry.city, entry.state].filter(Boolean).join(", ") || entry.region || "Place not listed";
}

export function profileHref(entry: Entry): string {
  if (!entry.slug) {
    return "/browse";
  }

  switch (entry.type) {
    case "campaign":
      return `/profiles/campaigns/${entry.slug}`;
    case "event":
      return `/profiles/events/${entry.slug}`;
    case "initiative":
      return `/profiles/initiatives/${entry.slug}`;
    case "organization":
      return `/profiles/organizations/${entry.slug}`;
    case "person":
      return `/profiles/people/${entry.slug}`;
  }
}

export { ArrowRight, ExternalLink, MapPinned } from "lucide-react";
