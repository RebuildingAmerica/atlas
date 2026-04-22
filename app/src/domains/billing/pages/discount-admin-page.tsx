import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";

interface VerificationRecord {
  user_id: string;
  segment: string;
  status: string;
  method: string;
  submitted_at: string;
  verified_at: string | null;
  verification_data: Record<string, string> | null;
  notes: string | null;
}

/**
 * Admin dashboard for managing discount verification requests.
 *
 * Allows admins to:
 * - View pending verification requests
 * - Filter by status and segment
 * - Approve or reject requests
 * - Add notes to records
 */
export function DiscountAdminPage() {
  const verificationQuery = useQuery({
    queryKey: ["admin", "verifications"],
    queryFn: async () => {
      const response = await fetch("/api/admin/verifications");
      if (!response.ok) {
        throw new Error("Failed to load verifications");
      }
      return response.json() as Promise<{
        records: VerificationRecord[];
        total: number;
      }>;
    },
  });

  if (verificationQuery.isPending) {
    return (
      <div className="space-y-3 py-10">
        <p className="type-title-large text-ink-strong">Loading verifications...</p>
      </div>
    );
  }

  if (verificationQuery.isError) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
        <AlertCircle className="text-red-600" />
        <p className="text-sm text-red-700">
          {verificationQuery.error instanceof Error
            ? verificationQuery.error.message
            : "Failed to load verifications"}
        </p>
      </div>
    );
  }

  const records = verificationQuery.data?.records || [];
  const total = verificationQuery.data?.total || 0;

  return (
    <div className="space-y-6 py-10">
      <div className="space-y-2">
        <h1 className="type-title-large text-ink-strong">Discount Verification Cohorts</h1>
        <p className="type-body-medium text-ink-soft">
          Manage requests from users requesting discounted access.
        </p>
      </div>

      <div className="border-border bg-surface-container-lowest rounded-lg border p-4">
        <p className="type-label-medium text-ink-muted mb-3">Summary</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="type-label-small text-ink-muted">Total requests</p>
            <p className="type-title-small text-ink-strong">{total}</p>
          </div>
          <div className="space-y-1">
            <p className="type-label-small text-ink-muted">Pending review</p>
            <p className="type-title-small text-ink-strong">
              {records.filter((r) => r.status === "pending").length}
            </p>
          </div>
          <div className="space-y-1">
            <p className="type-label-small text-ink-muted">Verified</p>
            <p className="type-title-small text-ink-strong">
              {records.filter((r) => r.status === "verified").length}
            </p>
          </div>
          <div className="space-y-1">
            <p className="type-label-small text-ink-muted">Rejected</p>
            <p className="type-title-small text-ink-strong">
              {records.filter((r) => r.status === "rejected").length}
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="type-label-medium text-ink-muted mb-3">Verification requests</p>
        {records.length === 0 ? (
          <div className="border-border rounded-lg border bg-white p-6 text-center">
            <p className="type-body-medium text-ink-soft">No verification requests yet.</p>
          </div>
        ) : (
          <div className="space-y-2 overflow-x-auto">
            {records.map((record) => (
              <div
                key={record.user_id}
                className="border-border rounded-lg border bg-white p-4 sm:p-5"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="type-title-small text-ink-strong">{record.user_id}</p>
                      <span className="type-label-small bg-surface-container-lowest text-ink-strong rounded-full px-2 py-0.5">
                        {record.segment.replace(/_/g, " ")}
                      </span>
                      <span
                        className={`type-label-small rounded-full px-2 py-0.5 ${
                          record.status === "verified"
                            ? "bg-emerald-50 text-emerald-700"
                            : record.status === "rejected"
                              ? "bg-red-50 text-red-700"
                              : "bg-yellow-50 text-yellow-700"
                        }`}
                      >
                        {record.status}
                      </span>
                    </div>
                    <p className="type-body-small text-ink-soft">
                      Submitted:{" "}
                      {new Date(record.submitted_at).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                    {record.notes && (
                      <p className="type-body-small text-ink-strong italic">"{record.notes}"</p>
                    )}
                  </div>
                  <a
                    href={`/admin/verifications/${record.user_id}`}
                    className="type-label-small text-accent hover:text-accent-dark whitespace-nowrap underline"
                  >
                    View details
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
