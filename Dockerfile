# syntax=docker/dockerfile:1
#
# Production image for the Dostoori app. Multi-stage: a full toolchain builds
# the standalone bundle, the runtime image ships only that plus the Prisma
# CLI (for `migrate deploy` on the box). See HOSTINGER_DEPLOY.md.
#
# The build needs NO database and NO secrets: nothing is prerendered from
# MySQL (the landing page renders per request), and the env placeholders
# below only satisfy src/lib/env.ts's import-time validation.

# ---------- deps ----------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall runs `prisma generate` + the OCR model copy; neither the schema
# nor the script is here yet, so skip lifecycle scripts and run both
# explicitly in the build stage instead.
RUN npm ci --ignore-scripts

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app
# openssl: Prisma detects the platform's OpenSSL to pick its engine binaries;
# without it, it guesses 1.1 and fetches a schema engine the runtime can't run.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-only placeholders for src/lib/env.ts's fail-closed validation (it runs
# when `next build` imports server modules). This stage is discarded; the
# runtime container gets the real values from .env / docker-compose.
ENV JWT_SECRET="build-only-placeholder-not-a-real-secret-000000"
ENV TWO_FACTOR_ENCRYPTION_KEY="build-only-placeholder-not-a-real-secret-000000"
ENV DATABASE_URL="mysql://build:build@127.0.0.1:1/build"
ENV APP_URL="https://build.invalid"
ENV PLATFORM_ADMIN_EMAILS="build@build.invalid"
ENV NEXT_TELEMETRY_DISABLED=1

# assemble-standalone.mjs completes .next/standalone with everything output
# tracing can't see (static assets, Prisma CLI + migrations, tesseract.js's
# worker/WASM and their dependencies, OCR models, the platform-admin CLI).
# The HTTP-level test suite (npm run test:http) runs this same script, so the
# layout tested is the layout shipped.
RUN npx prisma generate \
 && node scripts/prepare-ocr-models.mjs \
 && npm run build \
 && node scripts/assemble-standalone.mjs

# ---------- runtime ----------
FROM node:22-slim AS runner
WORKDIR /app

# Release identity — surfaced by /api/health so a running container can be
# matched to the commit it was built from (see deploy/deploy.sh, rollback.sh).
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="dostoori" \
      org.opencontainers.image.revision="${APP_VERSION}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.js (Next standalone) reads these; 0.0.0.0 so the container is
# reachable, not just its own loopback.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# openssl: Prisma's engine binaries link against libssl.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Application files stay root-owned (the app can't modify its own code);
# only what it must write to belongs to `node`: uploaded case documents
# (bind-mounted from the host in docker-compose.yml) and Next's cache dir.
COPY --from=build /app/.next/standalone ./
RUN mkdir -p storage/case-documents .next/cache \
    && chown -R node:node storage .next/cache
USER node

EXPOSE 3000

# "Container running" is not "app healthy": /api/health checks the database
# and the storage mount for real. node:slim has no curl — use node's fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
