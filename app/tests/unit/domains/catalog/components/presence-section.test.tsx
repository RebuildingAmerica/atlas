// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PresenceSection } from "@/domains/catalog/components/profiles/presence-section";

afterEach(() => {
  cleanup();
});

describe("PresenceSection", () => {
  it("renders nothing when all presence fields are missing", () => {
    const { container } = render(<PresenceSection />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the website hero card and strips the leading www", () => {
    render(<PresenceSection website="https://www.example.org/path" />);
    expect(screen.getByText("example.org")).toBeInTheDocument();
    expect(screen.getByText(/Official website/i)).toBeInTheDocument();
  });

  it("returns the raw value when the website is not a parseable URL", () => {
    render(<PresenceSection website="not a url" />);
    expect(screen.getByText("not a url")).toBeInTheDocument();
  });

  it("renders the email contact cell with a mailto link", () => {
    render(<PresenceSection email="hello@example.org" />);
    const link = screen.getByRole("link", { name: /hello@example.org/ });
    expect(link).toHaveAttribute("href", "mailto:hello@example.org");
  });

  it("renders the phone contact cell with a tel link", () => {
    render(<PresenceSection phone="555-0100" />);
    const link = screen.getByRole("link", { name: /555-0100/ });
    expect(link).toHaveAttribute("href", "tel:555-0100");
  });

  it("renders the formatted first-seen date", () => {
    render(<PresenceSection firstSeen="2026-04-15T00:00:00Z" />);
    expect(screen.getByText(/Apr|Mar|2026/)).toBeInTheDocument();
  });

  it("returns the raw value when first-seen is not a parseable date", () => {
    render(<PresenceSection firstSeen="not-a-date" />);
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
  });

  it("renders only the website card when no contact details are provided", () => {
    render(<PresenceSection website="https://example.org" />);
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
    expect(screen.queryByText("First seen")).not.toBeInTheDocument();
  });

  it("renders an ungrounded website as a non-link card with an unconfirmed caption", () => {
    render(<PresenceSection website="https://example.org" websiteGrounded={false} />);
    expect(screen.queryByRole("link", { name: /example\.org/ })).toBeNull();
    expect(screen.getByText("example.org")).toBeInTheDocument();
    expect(screen.getByText("Not confirmed by a source")).toBeInTheDocument();
  });

  it("renders an ungrounded email as plain text with an unconfirmed caption", () => {
    render(<PresenceSection email="hello@example.org" emailGrounded={false} />);
    expect(screen.queryByRole("link", { name: /hello@example\.org/ })).toBeNull();
    expect(screen.getByText("hello@example.org")).toBeInTheDocument();
    expect(screen.getByText("Not confirmed by a source")).toBeInTheDocument();
  });
});
