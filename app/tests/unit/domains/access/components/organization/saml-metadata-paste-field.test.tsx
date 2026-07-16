// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const parserMocks = vi.hoisted(() => ({
  parseSamlIdpMetadata: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-access/saml-metadata-parser", () => ({
  parseSamlIdpMetadata: parserMocks.parseSamlIdpMetadata,
}));

import { SamlMetadataPasteField } from "@/domains/access/components/organization/saml-metadata-paste-field";

describe("SamlMetadataPasteField", () => {
  beforeEach(() => {
    parserMocks.parseSamlIdpMetadata.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("disables the prefill button until the textarea has content", () => {
    render(<SamlMetadataPasteField onPrefill={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Prefill from metadata/i })).toBeDisabled();
  });

  it("renders an error status when the parser rejects the document", () => {
    parserMocks.parseSamlIdpMetadata.mockReturnValue({ ok: false, error: "malformed XML" });
    render(<SamlMetadataPasteField onPrefill={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/IdP metadata XML/i), { target: { value: "<broken>" } });
    fireEvent.click(screen.getByRole("button", { name: /Prefill from metadata/i }));
    expect(screen.getByText(/malformed XML/i)).toBeInTheDocument();
  });

  it("calls onPrefill and lists the filled fields on success", () => {
    parserMocks.parseSamlIdpMetadata.mockReturnValue({
      ok: true,
      metadata: {
        issuer: "https://idp.example",
        entryPoint: "https://idp.example/sso",
        certificate: "-----BEGIN CERTIFICATE-----\nbody\n-----END CERTIFICATE-----",
      },
    });
    const onPrefill = vi.fn();
    render(<SamlMetadataPasteField onPrefill={onPrefill} />);
    fireEvent.change(screen.getByLabelText(/IdP metadata XML/i), { target: { value: "<xml/>" } });
    fireEvent.click(screen.getByRole("button", { name: /Prefill from metadata/i }));
    expect(onPrefill).toHaveBeenCalledWith({
      issuer: "https://idp.example",
      entryPoint: "https://idp.example/sso",
      certificate: "-----BEGIN CERTIFICATE-----\nbody\n-----END CERTIFICATE-----",
    });
    expect(screen.getByText(/Filled issuer, sign-in URL, certificate/i)).toBeInTheDocument();
  });

  it("describes a metadata document that produced no usable fields", () => {
    parserMocks.parseSamlIdpMetadata.mockReturnValue({
      ok: true,
      metadata: { issuer: "", entryPoint: "", certificate: "" },
    });
    const onPrefill = vi.fn();
    render(<SamlMetadataPasteField onPrefill={onPrefill} />);
    fireEvent.change(screen.getByLabelText(/IdP metadata XML/i), { target: { value: "<xml/>" } });
    fireEvent.click(screen.getByRole("button", { name: /Prefill from metadata/i }));
    expect(onPrefill).toHaveBeenCalled();
    expect(screen.getByText(/Filled no fields/i)).toBeInTheDocument();
  });
});
