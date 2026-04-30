// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DevMailCaptureBanner } from "@/domains/access/pages/auth/dev-mail-capture-banner";

describe("DevMailCaptureBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the dev-mode label and a link to the capture URL", () => {
    render(<DevMailCaptureBanner url="http://mail.test/capture" />);
    expect(screen.getByText(/Dev mode/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open mail capture/ });
    expect(link).toHaveAttribute("href", "http://mail.test/capture");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
