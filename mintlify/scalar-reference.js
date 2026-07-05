(function () {
  const targetSelector = "[data-atlas-scalar-reference]";
  const scalarScriptUrl =
    "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.4";
  const defaultOpenApiUrl = "openapi/atlas.openapi.json";
  let scalarLoadPromise;

  function ensureStyles() {
    if (document.getElementById("atlas-scalar-reference-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "atlas-scalar-reference-style";
    style.textContent = `
[data-atlas-scalar-reference] {
  min-height: calc(100vh - 4rem);
}

[data-atlas-scalar-reference] .light-mode,
[data-atlas-scalar-reference] .dark-mode {
  --scalar-color-accent: #a67b50;
  --scalar-color-accent-hover: #8d6640;
}
`;
    document.head.append(style);
  }

  function loadScalar() {
    if (window.Scalar?.createApiReference) {
      return Promise.resolve(window.Scalar);
    }

    if (scalarLoadPromise) {
      return scalarLoadPromise;
    }

    scalarLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scalarScriptUrl;
      script.async = true;
      script.onload = () => resolve(window.Scalar);
      script.onerror = () => reject(new Error("Scalar API Reference failed to load."));
      document.head.append(script);
    });

    return scalarLoadPromise;
  }

  function ensureTargetId(target) {
    if (!target.id) {
      target.id = "atlas-scalar-api-reference";
    }
    return target.id;
  }

  async function mountScalar(target) {
    if (target.dataset.scalarMounted === "true") {
      return;
    }

    target.dataset.scalarMounted = "true";
    ensureStyles();

    const scalar = await loadScalar();
    const targetId = ensureTargetId(target);
    const openApiUrl = target.dataset.openapiUrl || defaultOpenApiUrl;

    scalar.createApiReference(`#${targetId}`, {
      title: "Atlas REST API",
      url: openApiUrl,
      layout: "modern",
      theme: "default",
      showSidebar: true,
      showDeveloperTools: "always",
      operationTitleSource: "summary",
      hideModels: false,
      modelsSectionLabel: "Schemas",
      documentDownloadType: "both",
      hideTestRequestButton: false,
      hideSearch: false,
      showOperationId: true,
      hideDarkModeToggle: false,
      persistAuth: true,
      telemetry: false,
      defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
      defaultOpenFirstTag: true,
      defaultOpenAllTags: false,
      expandAllModelSections: false,
      expandAllResponses: false,
      expandAllSchemaProperties: false,
      orderSchemaPropertiesBy: "preserve",
      orderRequiredPropertiesFirst: true,
      withDefaultFonts: true,
      searchHotKey: "k",
    });
  }

  function scanForScalarTargets() {
    document.querySelectorAll(targetSelector).forEach((target) => {
      void mountScalar(target);
    });
  }

  scanForScalarTargets();
  window.addEventListener("DOMContentLoaded", scanForScalarTargets);

  const observer = new MutationObserver(scanForScalarTargets);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
