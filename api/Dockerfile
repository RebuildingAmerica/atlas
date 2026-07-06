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

# Pinned to match pnpm-workspace.yaml's catalog "turbo" version, so pruning
# behavior can't drift from what the rest of the monorepo actually runs.
RUN npm install -g turbo@2.10.3

WORKDIR /repo
COPY . .
RUN turbo prune @rebuildingamerica/entity-widgets-mcp --docker

FROM node:24-alpine AS widget-builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable

WORKDIR /repo

# turbo prune computed the full dependency closure this package actually
# needs (entity-widgets-mcp, entity-widgets, eslint-config) and copied their
# manifests into out/json/ -- so this install layer stays correctly scoped
# and cacheable without a hand-maintained COPY list that has to be updated
# every time a package is added, renamed, or split.
COPY --from=widget-pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Same pruned package set, this time with source (out/full/).
COPY --from=widget-pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@rebuildingamerica/entity-widgets-mcp

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /build/api/atlas /app/atlas
COPY --from=widget-builder /repo/packages/entity-widgets-mcp/dist/widget /app/atlas/platform/mcp/_widget_assets

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8000

CMD ["uvicorn", "atlas.main:app", "--host", "0.0.0.0", "--port", "8000"]
