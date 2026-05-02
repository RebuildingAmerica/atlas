// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SamlCertificateRotationForm } from "@/domains/access/components/organization/saml-certificate-rotation-form";

describe("SamlCertificateRotationForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables the rotate button until a certificate is pasted in", () => {
    render(
      <SamlCertificateRotationForm isPending={false} providerId="provider_a" onSubmit={vi.fn()} />,
    );
    const button = screen.getByRole("button", { name: /Replace certificate/ });
    expect(button).toBeDisabled();
  });

  it("forwards the providerId and certificate body, then clears the textarea on success", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <SamlCertificateRotationForm isPending={false} providerId="provider_a" onSubmit={onSubmit} />,
    );

    const textarea = screen.getByLabelText(/New X\.509 certificate/);
    fireEvent.change(textarea, {
      target: { value: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Replace certificate/ }));
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith(
      "provider_a",
      "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----",
    );
    // After submit the textarea is cleared.
    expect(textarea).toHaveValue("");
  });

  it("disables the rotate button while the parent reports a pending mutation", () => {
    render(
      <SamlCertificateRotationForm isPending={true} providerId="provider_a" onSubmit={vi.fn()} />,
    );
    const textarea = screen.getByLabelText(/New X\.509 certificate/);
    fireEvent.change(textarea, { target: { value: "anything" } });
    const button = screen.getByRole("button", { name: /Replace certificate/ });
    expect(button).toBeDisabled();
  });
});
