# syntax=docker/dockerfile:1.7
#
# Build from the REPOSITORY ROOT (the server compiles in the app's ../src query layer):
#   docker build -f server/Dockerfile -t schockboard-server .
# BuildKit picks up server/Dockerfile.dockerignore automatically.

# ---- build ---------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /repo/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund

# App sources the server reuses (queries, domain logic, wire protocol).
COPY src /repo/src
COPY server /repo/server

RUN npm run build \
  && test -f dist/server.js \
  && test -f dist/public/index.html

# ---- runtime -------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app
# Everything (hono, jose, zod, app queries) is bundled into dist/server.js; no node_modules needed.
COPY --from=build --chown=root:root /repo/server/dist ./dist

# Unraid convention: nobody (99) / users (100) own everything under appdata.
RUN mkdir -p /data && chown 99:100 /data

USER 99:100
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server.js"]
