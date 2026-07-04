import { cn } from "@/lib/utils";
import {
  ProfileImage,
  type ProfileImageFetchPriority,
  type ProfileImageLoading,
} from "./profile-image";

type ActorType = "person" | "organization";
type AvatarSize = "sm" | "md" | "lg";

interface ActorAvatarProps {
  name: string;
  type: ActorType;
  size?: AvatarSize;
  photoUrl?: string;
  loading?: ProfileImageLoading;
  fetchPriority?: ProfileImageFetchPriority;
}

const SIZE_MAP: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-14 w-14 text-base",
};

const SIZE_PIXELS: Record<AvatarSize, number> = {
  sm: 32,
  md: 48,
  lg: 56,
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");
}

export function ActorAvatar({
  name,
  type,
  size = "md",
  photoUrl,
  loading = "lazy",
  fetchPriority = "auto",
}: ActorAvatarProps) {
  const sizeClasses = SIZE_MAP[size];
  const imageSize = SIZE_PIXELS[size];
  const shapeClass = type === "person" ? "rounded-full" : "rounded-xl";
  const gradientClass =
    type === "person"
      ? "bg-gradient-to-br from-accent to-accent-deep"
      : "bg-gradient-to-br from-ink-muted to-ink-soft";

  if (photoUrl) {
    return (
      <ProfileImage
        src={photoUrl}
        alt={name}
        width={imageSize}
        height={imageSize}
        loading={loading}
        fetchPriority={fetchPriority}
        className={cn(sizeClasses, shapeClass)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold text-white",
        sizeClasses,
        shapeClass,
        gradientClass,
      )}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
}
