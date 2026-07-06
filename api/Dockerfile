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

FROM node:24-alpine AS widget-builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable

WORKDIR /repo

# Copy manifests only so the install layer is cached independently of source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/entity-widgets/package.json packages/entity-widgets/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @rebuildingamerica/entity-widgets...

COPY packages/entity-widgets packages/entity-widgets

WORKDIR /repo/packages/entity-widgets
RUN pnpm run build

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /build/api/atlas /app/atlas
COPY --from=widget-builder /repo/packages/entity-widgets/dist/widget /app/atlas/platform/mcp/_widget_assets

ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 8000

CMD ["uvicorn", "atlas.main:app", "--host", "0.0.0.0", "--port", "8000"]
