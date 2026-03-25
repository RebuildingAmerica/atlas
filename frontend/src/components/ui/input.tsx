import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  type?: string;
  disabled?: boolean;
  error?: string;
  required?: boolean;
  className?: string;
  icon?: ReactNode;
  min?: string | number;
  max?: string | number;
}

export function Input({
  value,
  onChange,
  placeholder,
  label,
  type = "text",
  disabled = false,
  error,
  required = false,
  className,
  icon,
  min,
  max,
}: InputProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && <div className="absolute top-3 left-3 text-gray-400">{icon}</div>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          max={max}
          className={cn(
            "w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100",
            icon && "pl-10",
            error && "border-red-500",
            className,
          )}
        />
      </div>
      {error && <span className="text-sm text-red-500">{error}</span>}
    </div>
  );
}
