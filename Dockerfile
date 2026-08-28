# syntax=docker/dockerfile:1

# ---------- deps ----------
FROM node:22-slim AS deps
WORKDIR /app
# puppeteer's postinstall downloads Chromium to $HOME/.cache by default, which
# lives outside /app and would be lost between stages. Pinning it under /app
# keeps it on the same COPY --from path as node_modules.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- build ----------
FROM node:22-slim AS build
WORKDIR /app
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.cache ./.cache
COPY . .
# No env vars here on purpose: src/lib/env.ts validates lazily, so the build
# needs no secrets. If this step ever starts demanding one, that's a regression.
RUN npm run build

# ---------- runtime ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# tesseract.js downloads its language data at runtime and needs CA certs to do
# it over TLS; node:slim ships without them.
#
# The rest is puppeteer's Chromium: node:slim has none of the shared libraries
# a browser needs to even start, and fonts-noto-* gives it real Arabic glyphs
# to shape (draftToPdf prints Arabic drafts — no Arabic font means empty boxes).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-noto-core fonts-noto-naskh-arabic \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.cache ./.cache
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /data/storage && chown -R node:node /data /app
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]
