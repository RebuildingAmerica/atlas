import type { ReactNode } from "react";
import { cn } from "../utils";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  className,
}: BadgeProps) {
  const variants = {
    default: "bg-surface-alt text-on-surface-variant",
    success: "bg-success-container text-on-success-container",
    warning: "bg-warning-container text-on-warning-container",
    error: "bg-error-container text-on-error-container",
    info: "bg-primary-container text-on-primary-container",
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
