# syntax=docker/dockerfile:1
# Paper Duel: one image that runs the game server and serves the built web client.
#
#   docker build -t paper-duel .
#   docker run -p 8787:8787 paper-duel        # then open http://localhost:8787
#
# NODE_IMAGE can point at a mirror if Docker Hub rate-limits you, e.g.
#   --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim
# Behind a TLS-intercepting proxy, pass its CA for the install step only (not kept in the image):
#   --secret id=ca_cert,src=/path/to/ca.crt
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- build ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN corepack enable
# Manifests first, so dependency installs are cached until a lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi \
 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @paper-duel/web build \
 && pnpm --filter @paper-duel/server build

# ---------- runtime ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    STATIC_DIR=/app/public \
    LOG_LEVEL=info
WORKDIR /app
# The server is bundled into one file with all its dependencies: no node_modules needed.
COPY --from=build /src/apps/server/dist/server.mjs /src/apps/server/dist/server.mjs.LEGAL.txt ./
COPY --from=build /src/apps/web/dist ./public
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.mjs"]
