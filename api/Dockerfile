# This image is assembled from two independent build pipelines that only
# meet in the final stage's COPY instructions:
#
# 1. The Python API itself (`builder`, below) -- the actual atlas-api
#    application, built with uv against api/pyproject.toml. No pnpm, no
#    turbo, no Node involved anywhere in this pipeline.
# 2. The MCP Apps widget bundles (`widget-pruner` + `widget-builder`) -- 3
#    small, self-contained HTML files the API serves as static assets. This
#    pipeline uses Node/pnpm/turbo ONLY because those widgets are React
#    components that need bundling; `turbo prune`'s target package
#    (@rebuildingamerica/entity-widgets-mcp) scopes ONLY this pipeline. It
#    has no relationship to the Python API and is not "the whole app" --
#    it's the dependency closure needed to build 3 HTML files.
#
# The final stage combines both: the Python venv/source from (1), and the
# built widget HTML from (2) copied in as plain static files.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /build

# Copy only manifests first so third-party dep install is cached
# independently of application source changes.
COPY libs/shared/pyproject.toml libs/shared/pyproject.toml
COPY libs/discovery-engine/pyproject.toml libs/discovery-engine/pyproject.toml
COPY api/pyproject.toml api/uv.lock api/README.md api/

WORKDIR /build/api
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-workspace

# Source copied after deps so edits don't bust the wheel-download layer.
WORKDIR /build
COPY libs/shared libs/shared
COPY libs/discovery-engine libs/discovery-engine
COPY api/atlas api/atlas

WORKDIR /build/api
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

FROM node:24-alpine AS widget-pruner

# Builds only the MCP widget HTML bundles -- see the file-level comment at
# the top of this Dockerfile. Nothing below this point touches the Python
# API.
#
# Pinned to match pnpm-workspace.yaml's catalog "turbo" version, so pruning
# behavior can't drift from what the rest of the monorepo actually runs.
RUN npm install -g turbo@2.10.3

WORKDIR /app
COPY . .
RUN turbo prune @rebuildingamerica/entity-widgets-mcp --docker

FROM node:24-alpine AS widget-builder

ENV PNPM_HOME=/pnpm \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PATH=/pnpm:$PATH

RUN corepack enable

WORKDIR /app

# turbo prune computed the full dependency closure this package actually
# needs (entity-widgets-mcp, entity-widgets, eslint-config) and copied their
# manifests into out/json/ -- so this install layer stays correctly scoped
# and cacheable without a hand-maintained COPY list that has to be updated
# every time a package is added, renamed, or split.
COPY --from=widget-pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Same pruned package set, this time with source (out/full/).
COPY --from=widget-pruner /app/out/full/ .
RUN --mount=type=cache,id=turbo,target=/app/.turbo \
    pnpm turbo run build --filter=@rebuildingamerica/entity-widgets-mcp

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /build/api/atlas /app/atlas
COPY --from=widget-builder /app/packages/entity-widgets-mcp/dist/widget /app/atlas/platform/mcp/_widget_assets

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8000

CMD ["uvicorn", "atlas.main:app", "--host", "0.0.0.0", "--port", "8000"]
