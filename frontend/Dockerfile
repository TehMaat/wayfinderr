# Build stage
FROM node:20-alpine AS builder

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_API_URL is left unset on purpose: the browser finds the backend
# on the same host, port 3001 (see lib/config.ts), so one image works everywhere

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
