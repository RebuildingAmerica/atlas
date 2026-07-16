import { useId, useState } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import type { StudentVerificationData } from "./discount-verification-payload";

type StudentErrorField = keyof StudentVerificationData;

interface StudentFormProps {
  onSubmit: (data: StudentVerificationData) => Promise<void>;
  isLoading?: boolean;
}

function describedBy(...ids: (string | undefined)[]): string | undefined {
  const description = ids.filter((id) => Boolean(id)).join(" ");
  return description || undefined;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function StudentForm({ onSubmit, isLoading = false }: StudentFormProps) {
  const formId = useId();
  const [schoolEmail, setSchoolEmail] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<StudentErrorField | null>(null);

  const schoolEmailId = `${formId}-school-email`;
  const schoolEmailHintId = `${schoolEmailId}-hint`;
  const schoolNameId = `${formId}-school-name`;
  const schoolNameHintId = `${schoolNameId}-hint`;
  const errorId = errorField ? `${formId}-${errorField}-error` : `${formId}-form-error`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setErrorField(null);

    if (!schoolEmail.trim()) {
      setError("School email is required");
      setErrorField("schoolEmail");
      return;
    }

    if (!isEmail(schoolEmail)) {
      setError("School email must be a valid email address");
      setErrorField("schoolEmail");
      return;
    }

    if (!schoolName.trim()) {
      setError("School or program is required");
      setErrorField("schoolName");
      return;
    }

    void onSubmit({ schoolEmail, schoolName }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Submission failed");
      setErrorField(null);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={schoolEmailId} className="text-ink-strong mb-2 block text-sm font-medium">
          School email
        </label>
        <p id={schoolEmailHintId} className="text-ink-soft mb-3 text-sm">
          Use the email address connected to your current school or program.
        </p>
        <input
          id={schoolEmailId}
          type="email"
          value={schoolEmail}
          onChange={(e) => {
            setSchoolEmail(e.target.value);
          }}
          placeholder="you@school.edu"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
          aria-invalid={errorField === "schoolEmail" ? true : undefined}
          aria-describedby={describedBy(
            schoolEmailHintId,
            errorField === "schoolEmail" ? errorId : undefined,
          )}
        />
      </div>

      <div>
        <label htmlFor={schoolNameId} className="text-ink-strong mb-2 block text-sm font-medium">
          School or program
        </label>
        <p id={schoolNameHintId} className="text-ink-soft mb-3 text-sm">
          Name the school, college, training program, or fellowship.
        </p>
        <input
          id={schoolNameId}
          type="text"
          value={schoolName}
          onChange={(e) => {
            setSchoolName(e.target.value);
          }}
          placeholder="Howard University"
          className="border-border w-full rounded-lg border px-3 py-2"
          disabled={isLoading}
          aria-invalid={errorField === "schoolName" ? true : undefined}
          aria-describedby={describedBy(
            schoolNameHintId,
            errorField === "schoolName" ? errorId : undefined,
          )}
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? "Submitting..." : "Request Verification"}
      </Button>
    </form>
  );
}
