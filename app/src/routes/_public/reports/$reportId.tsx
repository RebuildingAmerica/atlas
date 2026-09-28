import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getEntityFlagStatus } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import type { FlagStatusReceipt } from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas";
import { formatStableDateTime, MEDIUM_DATE } from "@rebuildingamerica/atlas-ui/format/date-time";
import { PageLayout } from "@rebuildingamerica/atlas-ui/layout/page-layout";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/reports/$reportId")({
  head: ({ params }) =>
    buildPageHead({
      title: "Report status | Atlas",
      description: "Check whether an Atlas editor has reviewed your report.",
      path: `/reports/${params.reportId}`,
      noindex: true,
    }),
  component: ReportStatusRoute,
});

/** Tells a reporter what happened to their report without revealing what anyone wrote. */
export function describeReportStatus(report: FlagStatusReceipt): string {
  if (report.status === "open") {
    return "Waiting for an editor.";
  }
  const reviewedOn = report.reviewed_at
    ? ` on ${formatStableDateTime(report.reviewed_at, MEDIUM_DATE)}`
    : "";
  if (report.status === "resolved") {
    return `An Atlas editor reviewed this report${reviewedOn} and resolved it.`;
  }
  return `An Atlas editor reviewed this report${reviewedOn} and did not change the record.`;
}

function ReportStatusRoute() {
  const { reportId } = Route.useParams();
  const report = useQuery({
    queryKey: ["report-status", reportId],
    queryFn: () => getEntityFlagStatus(reportId),
    retry: false,
  });

  return (
    <PageLayout className="py-6 lg:py-8">
      <main className="mx-auto max-w-xl space-y-3">
        <h1 className="type-headline-small text-ink-strong">Report status</h1>
        <p className="type-body-small text-ink-muted">
          Reference: <code className="break-all">{reportId}</code>
        </p>
        {report.isPending ? (
          <p role="status" className="type-body-medium text-ink-soft">
            Checking this report…
          </p>
        ) : report.isError ? (
          <p role="alert" className="type-body-medium text-on-error-container">
            Atlas could not find that report. Check the reference, or email hello@rebuildingus.org
            and include it.
          </p>
        ) : (
          <p role="status" className="type-body-medium text-ink-strong">
            {describeReportStatus(report.data)}
          </p>
        )}
      </main>
    </PageLayout>
  );
}
