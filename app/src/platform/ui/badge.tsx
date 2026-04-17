import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  const variants = {
    default: "bg-surface-alt text-ink-soft",
    success: "bg-green-100 text-green-800",
    warning: "bg-yellow-100 text-yellow-800",
    error: "bg-red-100 text-red-800",
    info: "bg-accent-soft text-accent-ink",
  };

  return (
    <span
      className={cn(
        "type-label-medium inline-block rounded-full px-2.5 py-1 font-semibold",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
