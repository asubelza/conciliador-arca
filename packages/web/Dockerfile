# packages/web/Dockerfile — build context MUST be the repo root (npm
# workspaces monorepo: shared-types has to be resolvable at build time, even
# though this app currently doesn't import it directly).
#
#   docker build -f packages/web/Dockerfile .

FROM node:20-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
# The root "postinstall" script (npm run build --workspace=shared-types)
# needs shared-types' source present, hence copying it in full here (unlike
# api/web, which only need their package.json for caching until "build").
COPY packages/shared-types packages/shared-types
COPY tsconfig.json ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm install --no-audit --no-fund

FROM deps AS build
COPY packages/web packages/web
COPY tsconfig.json ./
# NEXT_PUBLIC_API_URL is baked into the client bundle at build time (any
# NEXT_PUBLIC_* var is inlined by `next build`, not read at container start),
# so it has to be a build arg, not a runtime env var.
ARG NEXT_PUBLIC_API_URL=http://localhost:3002
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build --workspace=web

# output: 'standalone' (next.config.js) traces the exact node_modules subset
# this app needs into .next/standalone, including a runnable server.js — no
# need to npm install again or ship the monorepo's full node_modules here.
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/packages/web/.next/standalone ./
COPY --from=build /repo/packages/web/.next/static ./packages/web/.next/static
# No packages/web/public directory exists yet in this app (no static assets
# checked in) -- add a `COPY --from=build /repo/packages/web/public
# ./packages/web/public` line back here if one gets added later.
WORKDIR /app/packages/web
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
