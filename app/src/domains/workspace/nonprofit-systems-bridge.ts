export interface NonprofitSystemsBridgeItem {
  entry_id: string;
  note?: string | null;
  entry?: {
    address?: {
      city?: string | null;
      state?: string | null;
    } | null;
    name?: string | null;
    source_count?: number | null;
    type?: string | null;
  } | null;
}

export interface NonprofitSystemsPacketInput {
  listName: string;
  workspaceName: string;
  description: string | null;
  actorCount: number;
  sourceCount: number;
  noteCount: number;
  nextAction: string;
  items: NonprofitSystemsBridgeItem[];
  locationForItem: (item: NonprofitSystemsBridgeItem) => string;
}

export function buildNonprofitSystemsPacket({
  listName,
  workspaceName,
  description,
  actorCount,
  sourceCount,
  noteCount,
  nextAction,
  items,
  locationForItem,
}: NonprofitSystemsPacketInput): string {
  const lines = [`${listName} nonprofit systems packet`, `Workspace: ${workspaceName}`];
  if (description) {
    lines.push(`Description: ${description}`);
  }
  lines.push("");
  lines.push(`Actors: ${actorCount}`);
  lines.push(`Sources: ${sourceCount}`);
  lines.push(`Notes: ${noteCount}`);
  lines.push("Ready for: Advocacy CRM, grant diligence, coalition ops");
  lines.push("");

  if (items.length === 0) {
    lines.push("No saved actors yet.");
    return lines.join("\n");
  }

  items.forEach((item) => {
    const actor = item.entry;
    const sourceCountForItem = actor?.source_count ?? 0;
    const sourceLabel = sourceCountForItem === 1 ? "source" : "sources";
    lines.push(
      `${actor?.name ?? "Profile unavailable"} — ${actor?.type ?? ""} — ${locationForItem(
        item,
      )} — ${sourceCountForItem} ${sourceLabel}`,
    );
    if (item.note) {
      lines.push(`Note: ${item.note}`);
    }
    lines.push(`Next action: ${nextAction}`);
  });

  return lines.join("\n");
}
