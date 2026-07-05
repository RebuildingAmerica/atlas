import { CheckCircle2, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { TrustLevel } from "@/types";

interface MapTrustLineProps {
  /** The actor's canonical trust tier, mirrored straight from its dot. */
  trustLevel: TrustLevel;
}

/** The fully-resolved trust row: an icon, its tint, the copy, and the tone. */
interface TrustPresentation {
  Icon: typeof ShieldCheck;
  iconClass: string;
  label: string;
  toneClass: string;
}

/**
 * Resolve a trust tier to the same words and icons the profile's data-quality
 * block uses, so the panel a visitor reaches from a dot says exactly what the
 * full profile will.
 */
const TRUST_PRESENTATION: Record<TrustLevel, TrustPresentation> = {
  subject_verified: {
    Icon: ShieldCheck,
    iconClass: "text-civic",
    label: "Verified by subject",
    toneClass: "text-ink-strong",
  },
  atlas_verified: {
    Icon: CheckCircle2,
    iconClass: "text-civic",
    label: "Atlas-verified",
    toneClass: "text-ink-strong",
  },
  corroborated: {
    Icon: CheckCircle2,
    iconClass: "text-civic",
    label: "Corroborated",
    toneClass: "text-ink-strong",
  },
  unverified: {
    Icon: ShieldQuestion,
    iconClass: "text-ink-muted",
    label: "Unverified",
    toneClass: "text-ink-soft",
  },
};

/**
 * The trust row for a map detail panel — the profile's verification language
 * reduced to exactly what a {@link TrustLevel} carries, so the panel reached
 * from a civic dot matches the profile it links to.
 *
 * @param trustLevel The actor's canonical trust tier.
 */
export function MapTrustLine({ trustLevel }: MapTrustLineProps) {
  const { Icon, iconClass, label, toneClass } = TRUST_PRESENTATION[trustLevel];
  return (
    <span className={`type-body-medium inline-flex items-center gap-1.5 ${toneClass}`}>
      <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden />
      {label}
    </span>
  );
}
