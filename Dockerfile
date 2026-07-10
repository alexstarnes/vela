# Vela web app — Next.js + embedded Mastra orchestrator.
#
# This container runs ONLY the web app (UI, API, scheduler, heartbeat loop).
# The vela-helper bridge (workspace file access, git, CLI execution lane) must
# run on a machine the user controls, near the cloned repositories — never in
# this container. Point VELA_HELPER_URL at that machine (e.g. via Tailscale).
#
# Requires `output: 'standalone'` in next.config.ts.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time env: Next.js needs DATABASE_URL to exist for module evaluation,
# but no real connection is made during build.
ARG DATABASE_URL="postgres://build:build@localhost:5432/build"
ENV DATABASE_URL=$DATABASE_URL
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S vela && adduser -S vela -G vela

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER vela
EXPOSE 3000

# /api/health reports scheduler status; middleware keeps it public.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]

