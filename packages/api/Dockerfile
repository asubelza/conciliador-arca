# packages/api/Dockerfile — build context MUST be the repo root (this is an
# npm workspaces monorepo: shared-types has to be resolvable at build time).
#
#   docker build -f packages/api/Dockerfile .
#
# Same image serves both the HTTP API and the BullMQ worker — docker-compose
# picks which one via `command:` (dist/main.js vs
# dist/reconciliations/reconciliation.worker.main.js), since both are already
# produced by the same `nest build`.

FROM node:20-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared-types packages/shared-types
COPY tsconfig.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
# The root "postinstall" script (npm run build --workspace=shared-types)
# needs shared-types' source present -- see above, that's why it's copied in
# full here (unlike api/web, which only need their package.json for caching
# until the "build" stage below).
RUN npm install --no-audit --no-fund

FROM deps AS build
COPY packages/api packages/api
COPY tsconfig.json ./
RUN npm run build --workspace=conciliador-arca-api

FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/api/package.json packages/api/package.json
# --ignore-scripts: the root "postinstall" (npm run build --workspace=shared-types)
# needs the TypeScript compiler, which --omit=dev deliberately excludes here --
# shared-types/dist is already built and copied in from the "build" stage below,
# so there's nothing for postinstall to usefully do in this production install anyway.
RUN npm install --no-audit --no-fund --omit=dev --ignore-scripts --workspace=conciliador-arca-api --workspace=shared-types
COPY --from=build /repo/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /repo/packages/api/dist packages/api/dist
COPY packages/api/prisma packages/api/prisma
WORKDIR /repo/packages/api
# Default: the HTTP API. docker-compose overrides `command:` for the worker
# service to run reconciliation.worker.main.js instead.
CMD ["node", "dist/main.js"]
