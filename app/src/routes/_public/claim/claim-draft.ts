export interface ClaimDraft {
  atprotoIdentityId: string;
  dnsDomain: string;
  evidence: string;
  preferredContactChannel: string;
  privateNote: string;
  relationship: string;
  requestedChanges: string;
  useActiveWorkspace: boolean;
}

function claimDraftKey(slug: string): string {
  return `atlas:claim-draft:${slug}`;
}

export function loadClaimDraft(slug: string): ClaimDraft | null {
  const storage = claimDraftStorage();
  if (!storage) return null;
  const stored = storage.getItem(claimDraftKey(slug));
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== "object") return null;
    const draft = value as Partial<ClaimDraft>;
    if (
      typeof draft.atprotoIdentityId !== "string" ||
      typeof draft.dnsDomain !== "string" ||
      typeof draft.evidence !== "string" ||
      typeof draft.preferredContactChannel !== "string" ||
      typeof draft.privateNote !== "string" ||
      typeof draft.relationship !== "string" ||
      typeof draft.requestedChanges !== "string" ||
      typeof draft.useActiveWorkspace !== "boolean"
    ) {
      return null;
    }
    return draft as ClaimDraft;
  } catch {
    return null;
  }
}

export function saveClaimDraft(slug: string, draft: ClaimDraft): void {
  claimDraftStorage()?.setItem(claimDraftKey(slug), JSON.stringify(draft));
}

export function clearClaimDraft(slug: string): void {
  claimDraftStorage()?.removeItem(claimDraftKey(slug));
}

function claimDraftStorage(): Storage | null {
  if (typeof window === "undefined" || !("sessionStorage" in window)) return null;
  return window.sessionStorage;
}
