import { cn } from "@/lib/utils";

export type ProfileImageFetchPriority = "auto" | "high" | "low";
export type ProfileImageLoading = "eager" | "lazy";

interface ProfileImageProps {
  /** Accessible text; use an empty string for decorative profile art. */
  alt: string;
  /** Additional display classes supplied by the consuming profile surface. */
  className?: string;
  /** Browser fetch priority for the image. */
  fetchPriority?: ProfileImageFetchPriority;
  /** Intrinsic image height used to stabilize layout. */
  height: number;
  /** Browser loading strategy. */
  loading?: ProfileImageLoading;
  /** Remote or local image URL. */
  src: string;
  /** Intrinsic image width used to stabilize layout. */
  width: number;
}

/**
 * Shared loading policy for external profile images.
 *
 * Atlas profile photos may come from remote public sources, so every profile
 * image uses explicit dimensions, async decoding, and no referrer leakage by
 * default. Callers still control presentation size and whether a leading image
 * should be eager/high priority.
 */
export function ProfileImage({
  alt,
  className,
  fetchPriority = "auto",
  height,
  loading = "lazy",
  src,
  width,
}: ProfileImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      referrerPolicy="no-referrer"
      className={cn("object-cover", className)}
    />
  );
}
