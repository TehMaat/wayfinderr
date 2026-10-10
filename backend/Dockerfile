# unrar for the RAR archives in the downloads: RARLAB's, statically linked for
# Alpine by LinuxServer.io (Alpine has no unrar, and its 7-Zip is built without RAR).
# Pinned: bump it on purpose
FROM ghcr.io/linuxserver/unrar:7.2.7-ls18 AS unrar

# Node 22 on Alpine 3.24 (pinned: node:20-alpine stays on Alpine 3.23, where Qt pulls
# mesa and LLVM into mkvtoolnix, and ffmpeg has no DVD input)

# Build stage
FROM node:22-alpine3.24 AS builder

WORKDIR /build

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev && npx prisma generate

# Runtime stage
FROM node:22-alpine3.24

WORKDIR /app

# ffprobe (ffmpeg) for media info, openssl for Prisma. Ripping without MakeMKV:
# mkvmerge (mkvtoolnix) for Blu-ray, 7-Zip (7zz) for ISO images, ffmpeg's dvdvideo for DVD
RUN apk add --no-cache ffmpeg mkvtoolnix 7zip openssl
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
