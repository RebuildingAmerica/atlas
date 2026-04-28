# Build the Atlas web app from the monorepo root so workspace
# dependencies resolve via pnpm. Build context: repo root.
FROM node:24-alpine AS builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY app/package.json app/package.json
COPY packages packages

RUN pnpm install --frozen-lockfile --filter @rebuildingamerica/atlas-app...

COPY app app

WORKDIR /repo/app
RUN pnpm run build

FROM node:24-alpine AS runner

WORKDIR /app

COPY --from=builder /repo/app/dist ./dist
COPY --from=builder /repo/app/server.mjs ./server.mjs
COPY --from=builder /repo/app/node_modules ./node_modules
COPY --from=builder /repo/app/package.json ./package.json

EXPOSE 3000

CMD ["node", "server.mjs"]
