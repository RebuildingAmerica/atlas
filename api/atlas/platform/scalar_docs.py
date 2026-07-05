"""Scalar API reference rendering for the Atlas API."""

from __future__ import annotations

import json
from html import escape
from typing import Any

from fastapi.responses import HTMLResponse

SCALAR_API_REFERENCE_VERSION = "1.62.4"
SCALAR_API_REFERENCE_SCRIPT = (
    f"https://cdn.jsdelivr.net/npm/@scalar/api-reference@{SCALAR_API_REFERENCE_VERSION}"
)

SCALAR_API_REFERENCE_CONFIG: dict[str, Any] = {
    "title": "Atlas REST API",
    "url": "/openapi.json",
    "layout": "modern",
    "theme": "default",
    "showSidebar": True,
    "showDeveloperTools": "always",
    "operationTitleSource": "summary",
    "hideModels": False,
    "modelsSectionLabel": "Schemas",
    "documentDownloadType": "both",
    "hideTestRequestButton": False,
    "hideSearch": False,
    "showOperationId": True,
    "hideDarkModeToggle": False,
    "persistAuth": True,
    "telemetry": False,
    "defaultHttpClient": {"targetKey": "shell", "clientKey": "curl"},
    "defaultOpenFirstTag": True,
    "defaultOpenAllTags": False,
    "expandAllModelSections": False,
    "expandAllResponses": False,
    "expandAllSchemaProperties": False,
    "orderSchemaPropertiesBy": "preserve",
    "orderRequiredPropertiesFirst": True,
    "withDefaultFonts": True,
    "searchHotKey": "k",
    "customCss": """
body { margin: 0; }
#app { min-height: 100vh; }
.light-mode,
.dark-mode {
  --scalar-color-accent: #a67b50;
  --scalar-color-accent-hover: #8d6640;
}
""".strip(),
}


def render_scalar_api_reference_html(
    *,
    openapi_url: str = "/openapi.json",
    title: str = "Atlas REST API Docs",
) -> HTMLResponse:
    """Render the Scalar API reference as standalone HTML.

    Parameters
    ----------
    openapi_url
        URL for the OpenAPI document loaded by Scalar.
    title
        Browser title for the API reference document.

    Returns
    -------
    HTMLResponse
        HTML response that boots Scalar against the configured OpenAPI document.
    """
    configuration = {**SCALAR_API_REFERENCE_CONFIG, "url": openapi_url}
    configuration_json = json.dumps(configuration, sort_keys=True)
    page_title = escape(title)
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{page_title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="{SCALAR_API_REFERENCE_SCRIPT}"></script>
    <script>
      Scalar.createApiReference("#app", {configuration_json});
    </script>
  </body>
</html>
"""
    return HTMLResponse(html)
