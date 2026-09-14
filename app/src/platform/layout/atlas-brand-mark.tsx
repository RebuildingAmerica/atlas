import { cn } from "@/lib/utils";

type AtlasBrandMarkSize = "compact" | "large";

interface AtlasBrandMarkProps {
  size: AtlasBrandMarkSize;
}

const TILE_CLASS_NAMES: Record<AtlasBrandMarkSize, string> = {
  compact: "h-7 w-7 rounded-[0.85rem]",
  large: "h-12 w-12 rounded-2xl",
};

const GLYPH_CLASS_NAMES: Record<AtlasBrandMarkSize, string> = {
  compact: "h-5 w-5",
  large: "h-[2.125rem] w-[2.125rem]",
};

/**
 * Atlas brand mark: a person inside a map pin on the primary tile.
 *
 * The glyph is Google's Material Icons "PersonPinCircleRounded" (Apache
 * License 2.0), with path data taken from @mui/icons-material. The Rounded
 * style matches the softer, rounder tile used in app/public/favicon.svg and
 * the PWA icon set; app/public/favicon.svg itself uses "LocationOnRounded"
 * instead of the person variant because the person cut-out blurs away at
 * 16px. The glyph is decorative because every caller renders the "Atlas"
 * wordmark beside it.
 */
export function AtlasBrandMark({ size }: AtlasBrandMarkProps) {
  return (
    <span
      className={cn(
        "bg-primary text-on-primary flex shrink-0 items-center justify-center",
        TILE_CLASS_NAMES[size],
      )}
      data-testid="atlas-brand-mark"
    >
      <svg
        aria-hidden="true"
        className={GLYPH_CLASS_NAMES[size]}
        fill="currentColor"
        focusable="false"
        viewBox="0 0 24 24"
      >
        <path d="M12 2c-4.2 0-8 3.22-8 8.2 0 3.18 2.45 6.92 7.34 11.22.36.32.97.32 1.33 0C17.55 17.12 20 13.38 20 10.2 20 5.22 16.2 2 12 2M7.69 12.49C8.88 11.56 10.37 11 12 11s3.12.56 4.31 1.49C15.45 13.98 13.85 15 12 15s-3.45-1.02-4.31-2.51M12 6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2" />
      </svg>
    </span>
  );
}
