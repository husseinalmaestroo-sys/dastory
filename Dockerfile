# syntax=docker/dockerfile:1
#
# Production image for the Dostoori app. Multi-stage: a full toolchain builds
# the standalone bundle, the runtime image ships only that plus the Prisma
# CLI (for `migrate deploy` on the box). See HOSTINGER_DEPLOY.md.

# ---------- deps ----------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# postinstall runs `prisma generate`; the schema isn't here yet, so skip
# lifecycle scripts and generate explicitly in the build stage instead.
RUN npm ci --ignore-scripts

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# src/lib/env.ts validates JWT_SECRET / TWO_FACTOR_ENCRYPTION_KEY / DATABASE_URL
# eagerly at module load, and `next build` imports it. These throwaway values
# only satisfy that check during the build — they never reach the runtime
# image (this stage is discarded) and are overridden by the real .env at run.
ENV JWT_SECRET="build-only-placeholder-not-a-real-secret-000000"
ENV TWO_FACTOR_ENCRYPTION_KEY="build-only-placeholder-not-a-real-secret-000000"
ENV DATABASE_URL="mysql://build:build@localhost:3306/build"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate
RUN npm run build

# ---------- runtime ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.js (Next standalone) reads these; 0.0.0.0 so the container is
# reachable, not just its own loopback.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# openssl: Prisma's engine binaries link against libssl.
# ca-certificates: tesseract.js (document OCR) downloads its language data
# over TLS at first use, and node:slim does not always ship the CA bundle.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The standalone bundle: a pruned node_modules + server.js. `next build` does
# not copy static assets or public/ into it — those are separate COPYs.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Prisma: the generated client + its query engine aren't reliably traced into
# the standalone node_modules, and `migrate deploy` needs the CLI package +
# schema + migration files, none of which app code imports. Bring them in
# explicitly. deploy/deploy.sh runs the CLI via its build/index.js entry
# (the standalone prune drops node_modules/.bin, so `npx` can't be relied on).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/prisma ./prisma

# Uploaded case documents live here and are bind-mounted from the host in
# docker-compose.yml — created now so the dir is owned by `node`, not root.
RUN mkdir -p storage/case-documents && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
