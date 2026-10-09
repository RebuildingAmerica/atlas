import { vi } from "vitest";
import type { MergesViewProps } from "@/domains/editorial/merges-view";

/** Props for an idle merge page with no past merges, with any value changed. */
export function mergesViewProps(overrides: Partial<MergesViewProps> = {}): MergesViewProps {
  return {
    formResetKey: 0,
    isLoading: false,
    isMerging: false,
    isPreviewing: false,
    merges: [],
    onMerge: vi.fn(),
    onPairChange: vi.fn(),
    onPreview: vi.fn(),
    ...overrides,
  };
}
