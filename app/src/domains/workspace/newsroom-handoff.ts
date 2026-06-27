export interface NewsroomHandoffItem {
  entry_id: string;
  note?: string | null;
  entry?: {
    address?: {
      city?: string | null;
      state?: string | null;
    } | null;
    name?: string | null;
    source_count?: number | null;
  } | null;
}

export interface NewsroomAssignmentPacketInput {
  listName: string;
  description: string | null;
  actorCount: number;
  sourceCount: number;
  noteCount: number;
  nextAction: string;
  items: NewsroomHandoffItem[];
  locationForItem: (item: NewsroomHandoffItem) => string;
}

export function buildNewsroomAssignmentPacket({
  listName,
  description,
  actorCount,
  sourceCount,
  noteCount,
  nextAction,
  items,
  locationForItem,
}: NewsroomAssignmentPacketInput): string {
  const lines = [`${listName} assignment packet`];
  if (description) {
    lines.push(description);
  }
  lines.push("");
  lines.push(`Leads: ${actorCount}`);
  lines.push(`Sources: ${sourceCount}`);
  lines.push(`Notes: ${noteCount}`);
  lines.push(`Next action: ${nextAction}`);
  lines.push("");

  if (items.length === 0) {
    lines.push("No saved actors yet.");
    return lines.join("\n");
  }

  items.forEach((item) => {
    const actorName = item.entry?.name ?? "Profile unavailable";
    const sourceCountForItem = item.entry?.source_count ?? 0;
    const sourceLabel = sourceCountForItem === 1 ? "source" : "sources";
    lines.push(`${actorName} — ${locationForItem(item)} — ${sourceCountForItem} ${sourceLabel}`);
    if (item.note) {
      lines.push(`Note: ${item.note}`);
    }
  });

  return lines.join("\n");
}
