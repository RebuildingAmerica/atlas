# Scout Browser Rendering Fallback

Scout uses browser rendering as a bounded fallback for pages where normal HTML
fetching does not expose enough text. The user-facing purpose is trust: Atlas
should not miss source-backed civic actors just because a public page,
especially a local news page, renders its article body with JavaScript.

HTML fetching remains the primary path. Browser rendering is first-class enough
to be configured, tested, cached, and traced, but it is not attempted for every
page.

## Discovery Flow

1. Scout fetches the URL with the normal HTTP client.
2. It extracts article or page text from the returned HTML.
3. If the page fails because the text is thin, empty, blocked by a high-value
   status code, or shaped like a JavaScript app shell, Scout decides whether the
   URL is worth browser CPU.
4. Eligible pages get one Playwright Chromium render attempt within the current
   browser budget.
5. Rendered text and same-domain links enter the normal extraction, ranking,
   deduplication, and source-packet pipeline.

The fallback does not create a separate ingestion path. Browser-rendered pages
must still produce source-backed evidence before they can become Atlas entries.

## Trigger Conditions

Scout considers browser rendering when a normal fetch or extraction fails and at
least one of these is true:

- The URL looks high value: news-like domains, or paths such as `/news/`,
  `/article/`, `/articles/`, `/story/`, `/stories/`, `/local/`, `/politics/`, or
  `/government/`.
- The returned HTML looks like a JavaScript shell, including markers such as
  `__next`, `__NEXT_DATA__`, `__NUXT__`, `data-reactroot`, `ng-version`, or a
  script-heavy page with little visible text.
- A high-value URL returns an access-like HTTP status such as `401` or `403`.

Scout skips the fallback for low-value thin pages so routine crawls do not burn
browser CPU on every sparse page.

## Default Guardrails

These settings live under the `scraper` config section:

| Setting                       | Default | Purpose                                  |
| ----------------------------- | ------: | ---------------------------------------- |
| `browser_fallback_enabled`    |  `true` | Enables the bounded fallback.            |
| `browser_render_timeout_ms`   | `15000` | Caps each Chromium navigation.           |
| `max_browser_renders_per_run` |     `8` | Limits browser attempts per fetcher run. |
| `max_browser_concurrent`      |     `1` | Keeps browser renders serial by default. |

Inspect the active local profile:

```bash
scout-dev config show
```

Tune a launch run:

```bash
scout-dev config set scraper.browser_fallback_enabled true
scout-dev config set scraper.browser_render_timeout_ms 15000
scout-dev config set scraper.max_browser_renders_per_run 24
scout-dev config set scraper.max_browser_concurrent 2
```

Dial it back on a smaller machine:

```bash
scout-dev config set scraper.max_browser_renders_per_run 4
scout-dev config set scraper.max_browser_concurrent 1
```

## Cache And Provenance

Positive page-cache entries include `render_mode`:

- `html` means the normal fetch and extractor produced usable text.
- `browser` means Chromium produced the text that entered extraction.

Negative cache entries can include `browser_reason` when a browser attempt was
eligible but still failed or produced text too thin to use.

This metadata is operational provenance. It helps explain why Scout trusted a
source packet and helps diagnose gaps in local news coverage, but it does not
lower Atlas publication standards.

## Failure Modes

- `browser_render_unavailable`: Playwright is not installed in the active Scout
  environment.
- `browser_render_failed`: Chromium could not launch, navigate, or render within
  the timeout.
- `browser_empty_text`, `browser_short_text`, or another `browser_*` quality
  reason: the rendered page still did not expose enough usable text.
- Access controls, paywalls, or login walls can still block extraction. Browser
  rendering is for public JavaScript-rendered pages, not credentialed scraping.

## Operator Checks

Use the normal run and cache views to confirm whether Scout is getting usable
source pages:

```bash
scout-dev runs inspect RUN_ID
scout-dev pages list --limit 20
```

For a focused regression check after changing the fallback:

```bash
cd scout
uv run pytest --no-cov tests/test_scraper/test_fetcher.py tests/test_config.py -q
```

For a local smoke test against a known JavaScript-heavy source, run a small
direct URL discovery through `scout-dev`, then inspect the run receipt and page
cache before increasing the browser budget for a larger city crawl.
