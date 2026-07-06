(function () {
  const targetSelector = "[data-atlas-scalar-reference]";
  const staticFallbackSelector = "[data-atlas-api-static-fallback]";
  const scalarScriptUrl =
    "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.4";
  const defaultOpenApiUrl = "/openapi.json";
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

[data-atlas-scalar-reference][data-scalar-mounted="true"] .atlas-api-fallback {
  display: none !important;
}

[data-atlas-api-static-fallback][hidden] {
  display: none !important;
}

body:has([data-atlas-scalar-reference]) #sidebar,
body:has([data-atlas-scalar-reference]) #header {
  display: none !important;
}

body:has([data-atlas-scalar-reference]) #content-area {
  width: 100% !important;
  max-width: none !important;
  margin-left: 0 !important;
  padding-left: 0 !important;
}

body:has([data-atlas-scalar-reference]) #content {
  max-width: none !important;
  margin-top: 0 !important;
  margin-bottom: 0 !important;
  padding: 0 !important;
}

body:has([data-atlas-scalar-reference]) #content-container > div {
  padding-top: 0 !important;
}

body:has([data-atlas-scalar-reference]) [data-atlas-scalar-reference],
body:has([data-atlas-scalar-reference]) [data-atlas-api-static-fallback] {
  max-width: none !important;
  margin: 0 !important;
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
      script.onerror = () =>
        reject(new Error("Scalar API Reference failed to load."));
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

  function inferAtlasAppOrigin() {
    const { hostname, origin, port, protocol } = window.location;

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    ) {
      return "https://atlas.localhost";
    }

    if (hostname === "docs.atlas.localhost") {
      return "https://atlas.localhost";
    }

    if (hostname.startsWith("docs.")) {
      const appHostname = hostname.slice("docs.".length);
      const portSuffix = port ? `:${port}` : "";
      return `${protocol}//${appHostname}${portSuffix}`;
    }

    if (
      hostname.endsWith(".mintlify.app") ||
      hostname.endsWith(".mintlify.dev")
    ) {
      return "https://atlas.rebuildingus.org";
    }

    return origin;
  }

  function resolveOpenApiUrl(candidate) {
    const openApiUrl = candidate || defaultOpenApiUrl;

    if (/^https?:\/\//i.test(openApiUrl)) {
      return openApiUrl;
    }

    if (openApiUrl.startsWith("/")) {
      return new URL(openApiUrl, inferAtlasAppOrigin()).href;
    }

    return new URL(openApiUrl, window.location.href).href;
  }

  function findStaticFallback(target) {
    return target.parentElement?.querySelector(staticFallbackSelector) || null;
  }

  function setStaticFallbackHidden(target, hidden) {
    const fallback = findStaticFallback(target);

    if (fallback) {
      fallback.hidden = hidden;
    }
  }

  function setPostTargetFallbacksHidden(target, hidden) {
    let sibling = target.nextElementSibling;

    while (sibling) {
      sibling.hidden = hidden;
      sibling = sibling.nextElementSibling;
    }
  }

  async function mountScalar(target) {
    if (
      target.dataset.scalarMounted === "true" ||
      target.dataset.scalarLoading === "true"
    ) {
      return;
    }

    target.dataset.scalarLoading = "true";
    ensureStyles();
    setPostTargetFallbacksHidden(target, true);
    setStaticFallbackHidden(target, true);

    try {
      const scalar = await loadScalar();
      const targetId = ensureTargetId(target);
      const openApiUrl = resolveOpenApiUrl(target.dataset.openapiUrl);

      if (!target.isConnected || document.getElementById(targetId) !== target) {
        return;
      }

      target.replaceChildren();

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

      target.dataset.scalarMounted = "true";
      delete target.dataset.scalarError;
    } catch (error) {
      target.dataset.scalarError = "true";
      setPostTargetFallbacksHidden(target, true);
      setStaticFallbackHidden(target, false);
      // Keep the designed fallback visible if Scalar or the OpenAPI document fails.
      console.error(error);
    } finally {
      delete target.dataset.scalarLoading;
    }
  }

  function scanForScalarTargets() {
    document.querySelectorAll(targetSelector).forEach((target) => {
      void mountScalar(target);
    });
  }

  function startScalarReference() {
    scanForScalarTargets();

    const observer = new MutationObserver(scanForScalarTargets);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "complete") {
    window.setTimeout(startScalarReference, 0);
  } else {
    window.addEventListener("load", startScalarReference, { once: true });
  }
})();
