import type { PublicFirehoseSignal } from "@/domains/firehose/public-feed";

export function makeFirehoseSignal(
  base: PublicFirehoseSignal,
  id: string,
  detectedAt: string,
  overrides: Partial<PublicFirehoseSignal> = {},
): PublicFirehoseSignal {
  return {
    ...base,
    ...overrides,
    detected_at: detectedAt,
    evidence: {
      ...base.evidence,
      ...(overrides.evidence ?? {}),
    },
    id,
  };
}
