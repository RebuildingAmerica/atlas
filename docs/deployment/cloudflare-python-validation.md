# Cloudflare-only runtime validation

This records implementation evidence for the
[Cloudflare-only hosting plan](../superpowers/plans/2026-10-10-cloudflare-only-hosting.md).
The candidates remain protected evaluations. Production routing and the Vercel
subscription have not changed.

## Hosted Python and JavaScript dispatcher

The Python candidate runs FastAPI in a SQLite Durable Object and connects to the
existing PostgreSQL database through uncached Hyperdrive. Its small JavaScript
dispatcher calls the object through a binding, preserving API behavior without
spending Python CPU in the edge Worker.

| Check                  | Observed result, October 11 UTC                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Python deployment      | `20f2208d-c31d-4f4d-a14b-951661186a85`, source `c9a612d08e19295b58ab0a42b4a51b394031c831`                                      |
| JavaScript deployment  | `76e7e34a-a296-4c11-8d96-a7fedb68c20d`, source `8a760f3b22be792021a8596ab2171ac2ac37bb15`                                      |
| FastAPI health         | 200 with `private, no-store`                                                                                                   |
| PostgreSQL             | Read-only query succeeds; timezone offset is zero; a known offset timestamp converts to UTC; connection closes before response |
| Unauthenticated access | 403                                                                                                                            |
| Dispatcher sample      | 100/100 successful health requests, concurrency four, 03:49:37–03:49:39 UTC                                                    |
| Edge CPU               | 98 matched invocation records; p99 and maximum 1ms; all outcomes `ok`                                                          |
| Object CPU             | 99 matched invocation records; p99 and maximum 33ms; all outcomes `ok`                                                         |

The sample is a health-check compatibility result, not representative
application load or a production p99 gate. Missing invocation records prevent
claiming complete telemetry coverage. Requests used a verified TLS hostname at
an existing Cloudflare zone edge address while the new dispatcher's public DNS
provisioned; public DNS remains a separate check.

The upload artifact's `entry.py` matches the deployed version's downloaded
module bytes. Nevertheless, the existing object temporarily served the previous
version after the new edge deployment reached 100%. It later converged and
passed the timestamp contract. Cloudflare documents
[temporary version skew between Workers and Durable Objects](https://developers.cloudflare.com/durable-objects/platform/known-issues/).
Release readiness must verify the executing object's version and behavior,
rather than treating a deployment API response as application readiness.

## Shared account usage

Read directly from the Rebuilding America Cloudflare dashboard through its
Chrome profile:

| Dashboard                         | Observation                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Workers & Pages                   | 18,682 requests today against 100,000; October 1–11 total displayed as 21.91k                                                         |
| Durable Objects account usage     | October 11: 64.7 GB-seconds, 1.49k requests, zero storage and storage operations                                                      |
| Python object metrics, later read | 81.54 GB-seconds over the last 24 hours; zero CPU or memory limit errors; memory charts near 98MB p99, instance overview 104.29MB p99 |

These are different observation times, with dashboard aggregation delays. They
are not interchangeable with billing estimates from logs. Historical peak-day
usage and representative doubled-traffic duration still need verification. The
Python runtime's existing memory footprint requires measuring the full API and
discovery imports before promotion.

## Native dependencies

The first CI attempt stopped before compiling because optional resolver
dependencies were absent. The corrected workflow compiled `inflate64==1.0.4` and
`python-crfsuite==0.9.12` successfully in
[run 38109353304](https://github.com/RebuildingAmerica/atlas/actions/runs/38109353304),
without deployment secrets. Downloaded wheel hashes match the run's
`SHA256SUMS`:

| Wheel           | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| inflate64       | `c5c8030bbd8bafea662fbde1c7a071d66fcfd4731d2b0b38288f8a5772f5ba15` |
| python-crfsuite | `78b19564f3dfbdc5eb1e8a2c2ac73ac06cd455bea47e22c5eb4c677fcf59e1d8` |

[Run 38109752003](https://github.com/RebuildingAmerica/atlas/actions/runs/38109752003)
also compiled the exact locked Pydantic core, jiter, rpds, regex, and
doublemetaphone versions. Its `lxml` and `cryptography` builds failed because
their native XML and OpenSSL libraries were absent. The workflow now uses a
pinned upstream Pyodide recipe checkout and Atlas's existing source URLs and
hashes to build those libraries statically. That revised build and deployed
native-package behavior remain unverified.

Successful wheel builds do not establish that IRS archive decoding,
institutional-trustee detection, API validation, or cryptographic verification
work in the hosted runtime. The existing product capabilities remain required.

## Remaining release gates

The actual FastAPI routes, MCP lifecycle, durable discovery execution, firehose
delivery, and PDS dependencies still need hosted implementation and acceptance.
Request-context isolation tests pass locally; they do not establish hosted
identity isolation. Full sign-in, existing passkeys, workspaces, Stripe, search,
profiles, rollback, latency, quota forecasting, 24-hour staging and 72-hour
production observation remain required. The shared `rap-website` dependency must
be resolved before the Vercel charge can end.
