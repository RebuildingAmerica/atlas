import type { ReactNode } from "react";

/**
 * Props accepted by the minimal button stub used in jsdom unit tests.
 */
interface TestButtonProps {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
}

/**
 * Button stub that preserves the click and disabled semantics tests rely on
 * without pulling in full design-system behavior.
 */
export function TestButton({ children, disabled, onClick, type = "button" }: TestButtonProps) {
  return (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Props accepted by the minimal input stub used in jsdom unit tests.
 */
interface TestInputProps {
  label?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  value?: string;
}

/**
 * Input stub that preserves accessible labeling and change events.
 */
export function TestInput({ label, onChange, placeholder, type = "text", value }: TestInputProps) {
  return (
    <label>
      {label}
      <input
        aria-label={label}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
      />
    </label>
  );
}

/**
 * Props accepted by the minimal select stub used in jsdom unit tests.
 */
interface TestSelectProps {
  disabled?: boolean;
  label?: string;
  onChange?: (value: string) => void;
  options: { label: string; value: string }[];
  value?: string;
}

/**
 * Select stub that preserves accessible labeling and selection changes.
 */
export function TestSelect({ disabled, label, onChange, options, value }: TestSelectProps) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Props accepted by the minimal textarea stub used in jsdom unit tests.
 */
interface TestTextareaProps {
  label?: string;
  onChange?: (value: string) => void;
  value?: string;
}

/**
 * Textarea stub that preserves accessible labeling and change events.
 */
export function TestTextarea({ label, onChange, value }: TestTextareaProps) {
  return (
    <label>
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
      />
    </label>
  );
}

/**
 * Props accepted by the minimal link stub used in jsdom unit tests.
 */
interface TestLinkProps {
  children: ReactNode;
  className?: string;
  to: string;
}

/**
 * Link stub that keeps routing targets visible to tests without requiring a
 * full router instance.
 */
export function TestLink({ children, className, to }: TestLinkProps) {
  return (
    <a className={className} href={to}>
      {children}
    </a>
  );
}
