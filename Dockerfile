# syntax=docker/dockerfile:1

FROM node:26-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Abhängigkeiten inklusive Prisma-CLI
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Migrationen: einmaliger Dienst vor dem Start der Anwendung
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

# Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Nur für den Build: Next.js lädt Module, ohne dass Secrets oder Datenbank nötig wären.
ENV BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV BETTER_AUTH_URL=http://localhost:3000
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DISABLE_WORKER=true
RUN npx prisma generate && npx next build

# Laufzeit: nur die Standalone-Ausgabe, läuft nicht als root
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 kinora && useradd --system --uid 1001 --gid kinora kinora
COPY --from=builder --chown=kinora:kinora /app/public ./public
COPY --from=builder --chown=kinora:kinora /app/.next/standalone ./
COPY --from=builder --chown=kinora:kinora /app/.next/static ./.next/static
USER kinora
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
