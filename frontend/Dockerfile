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

EXPOSE 3000

CMD ["npm", "start"]
