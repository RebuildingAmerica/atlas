// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { isNotFound, notFound, rootRouteId } from "@tanstack/react-router";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureRenderError } from "@/../tests/helpers/capture-render-error";
import { DegradedRouteDataProbe } from "@/../tests/helpers/degraded-route-data-probe";
import { renderWithProviders } from "@/../tests/helpers/render-with-providers";

describe("useDegradedRouteData", () => {
  afterEach(() => {
    cleanup();
  });

  it("reports nothing while the fetch is out, then the data once it lands", async () => {
    const queryFn = vi.fn().mockResolvedValue("Las Vegas");

    renderWithProviders(<DegradedRouteDataProbe queryFn={queryFn} queryKey={["probe", "ok"]} />);

    expect(screen.getByTestId("probe")).toHaveTextContent("waiting");
    expect(await screen.findByText("Las Vegas")).toBeInTheDocument();
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it("retries a failed fetch quietly instead of surfacing the failure", async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Too many requests."), { status: 429 }))
      .mockResolvedValue("Las Vegas");

    renderWithProviders(<DegradedRouteDataProbe queryFn={queryFn} queryKey={["probe", "retry"]} />);

    expect(await screen.findByText("Las Vegas", undefined, { timeout: 3_000 })).toBeInTheDocument();
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("hands a missing record to the root not-found page", async () => {
    const onError = vi.fn();
    const queryFn = vi.fn().mockRejectedValue(notFound());

    renderWithProviders(
      <CaptureRenderError onError={onError}>
        <DegradedRouteDataProbe queryFn={queryFn} queryKey={["probe", "missing"]} />
      </CaptureRenderError>,
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    const thrown: unknown = onError.mock.calls[0]?.[0];
    expect(isNotFound(thrown)).toBe(true);
    expect(thrown).toMatchObject({ routeId: rootRouteId });
    expect(queryFn).toHaveBeenCalledOnce();
  });
});
