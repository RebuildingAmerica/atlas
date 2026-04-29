import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  type?: "button" | "submit" | "reset";
}

export function Button({
  children,
  className,
  onClick,
  disabled = false,
  title,
  variant = "primary",
  size = "md",
  type = "button",
}: ButtonProps) {
  const baseStyles =
    "type-label-large cursor-pointer rounded-full font-medium transition-[color,background-color,border-color,transform] duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-transparent active:translate-y-[1px]";

  const variants = {
    primary: "bg-primary text-white hover:bg-on-primary-container focus:ring-primary",
    secondary:
      "border border-outline-variant bg-surface-container-lowest text-on-surface hover:border-outline hover:bg-surface-container-high focus:ring-border-strong",
    ghost:
      "bg-transparent text-outline shadow-none hover:bg-surface-container-high hover:text-on-surface focus:ring-border",
  };

  const sizes = {
    sm: "px-3 py-1.5",
    md: "px-4 py-2.5",
    lg: "px-6 py-3",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        baseStyles,
        variants[variant],
        sizes[size],
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
