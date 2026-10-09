import type { ReactNode } from "react";
import { controlFocusClass } from "../styles/controls";
import { cn } from "../utils";

interface ButtonProps {
  children: ReactNode;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  type?: "button" | "submit" | "reset";
}

interface ButtonStyleOptions {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}
export function buttonStyles({
  variant = "primary",
  size = "md",
}: ButtonStyleOptions = {}) {
  const baseStyles =
    "type-label-large inline-flex items-center justify-center cursor-pointer rounded-full font-medium transition-[color,background-color,border-color,transform] duration-150 ease-out active:translate-y-[1px]";

  const variants = {
    primary:
      "bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container",
    secondary:
      "border border-outline-variant bg-surface-container-lowest text-on-surface hover:border-outline hover:bg-surface-container-high",
    ghost:
      "bg-transparent text-outline shadow-none hover:bg-surface-container-high hover:text-on-surface",
  };

  const sizes = {
    sm: "px-3 py-1.5",
    md: "px-4 py-2.5",
    lg: "min-h-12 px-6 py-3",
  };

  return cn(baseStyles, controlFocusClass, variants[variant], sizes[size]);
}

export function Button({
  ariaLabel,
  autoFocus,
  children,
  className,
  onClick,
  disabled = false,
  title,
  variant = "primary",
  size = "md",
  type = "button",
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        buttonStyles({ variant, size }),
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
