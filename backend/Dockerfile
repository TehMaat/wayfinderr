# unrar for the RAR archives in the downloads: RARLAB's, statically linked for
# Alpine by LinuxServer.io (Alpine has no unrar, and its 7-Zip is built without RAR).
# Pinned: bump it on purpose
FROM ghcr.io/linuxserver/unrar:7.2.7-ls18 AS unrar

# Build stage
FROM node:20-alpine AS builder

WORKDIR /build

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev && npx prisma generate

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# ffprobe (ffmpeg) for media info, openssl for Prisma
RUN apk add --no-cache ffmpeg openssl
COPY --from=unrar /usr/bin/unrar-alpine /usr/bin/unrar

COPY --from=builder /build/package*.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/prisma ./prisma

RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3001

# Apply migrations, then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
