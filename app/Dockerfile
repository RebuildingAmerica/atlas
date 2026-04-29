FROM node:24-alpine AS builder

ARG NITRO_PRESET=node-server

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NITRO_PRESET=${NITRO_PRESET}

RUN corepack enable

WORKDIR /repo

# Copy manifests only so the install layer is cached independently of source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY app/package.json app/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @rebuildingamerica/atlas-app...

COPY app app
COPY packages packages

WORKDIR /repo/app
RUN pnpm run build

FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=builder /repo/app/.output ./.output

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
