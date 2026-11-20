# Build stage
FROM node:20-alpine AS builder

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY . .

# The browser only talks to this server, which proxies /api, /health and /ws to
# the backend (next.config.js). The backend URL is compiled in by next build:
# the default is the compose service name, so the image works with any domain
ARG BACKEND_URL=http://wayfinderr-backend:3001
# Shown in the sidebar (next.config.js): the release tag (v1.2.3) and the commit.
# Empty, next build uses the package.json version
ARG APP_VERSION=
ARG GIT_COMMIT=

RUN npm run build && npm prune --omit=dev

# Runtime stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /build/package*.json ./
COPY --from=builder /build/next.config.js ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/.next ./.next
COPY --from=builder /build/public ./public
# Starts next start, and HTTPS in front of it when HTTPS_DOMAIN is set (docs/DEPLOYMENT.md)
COPY --from=builder /build/server.js ./
COPY --from=builder /build/https ./https

# 3000: the app, over HTTP, or HTTPS with HTTPS_DOMAIN and the certificate in /app/certs
EXPOSE 3000

# node directly (not npm): it gets docker stop's SIGTERM and stops Next.js cleanly
CMD ["node", "server.js"]
