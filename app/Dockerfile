FROM node:24-alpine AS builder

ARG NITRO_PRESET=node-server
ARG ATLAS_MANAGED=false
ARG ATLAS_MULTI_USER=true
ARG ATLAS_PUBLIC_URL
ARG ATLAS_DOCS_URL
ARG ATLAS_SERVER_API_PROXY_TARGET
ARG ATLAS_AUTH_JWT_AUDIENCES
ARG ATLAS_AUTH_BASE_PATH=/api/auth

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NITRO_PRESET=${NITRO_PRESET} \
    ATLAS_MANAGED=${ATLAS_MANAGED} \
    ATLAS_MULTI_USER=${ATLAS_MULTI_USER} \
    ATLAS_PUBLIC_URL=${ATLAS_PUBLIC_URL} \
    ATLAS_DOCS_URL=${ATLAS_DOCS_URL} \
    ATLAS_SERVER_API_PROXY_TARGET=${ATLAS_SERVER_API_PROXY_TARGET} \
    ATLAS_AUTH_JWT_AUDIENCES=${ATLAS_AUTH_JWT_AUDIENCES} \
    ATLAS_AUTH_BASE_PATH=${ATLAS_AUTH_BASE_PATH}

RUN corepack enable

WORKDIR /repo

# Copy manifests only so the install layer is cached independently of source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY app/package.json app/package.json
COPY packages packages

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @rebuildingamerica/atlas-app...

COPY app app
COPY openapi openapi

WORKDIR /repo/app
RUN pnpm run build

FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=builder /repo/app/.output ./.output
COPY services/web-edge/origin.mjs services/web-edge/start-origin.mjs ./web-origin/

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]

# Managed hosting opts into the guarded listener. Self-hosted Compose retains
# the existing standalone target and does not need Cloudflare credentials.
FROM runner AS cloud-run
CMD ["node", "web-origin/start-origin.mjs"]

FROM runner AS standalone
