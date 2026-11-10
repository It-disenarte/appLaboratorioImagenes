# Imagen para Easypanel (VPS Hostinger). Next.js en modo standalone: no necesita base de datos ni variables de entorno.

FROM node:20-bookworm-slim AS base
WORKDIR /app

# Dependencias
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Build (el script `prebuild` copia el motor del recorte de precisión a public/vendor)
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Ejecución
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
