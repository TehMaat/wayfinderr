-- CreateTable Server
CREATE TABLE "Server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "apiEndpoint" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "sshHost" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUsername" TEXT NOT NULL,
    "sshPath" TEXT NOT NULL DEFAULT '/uploads',
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "backoffStrategy" TEXT NOT NULL DEFAULT 'exponential',
    "mediaCheckPolicy" TEXT NOT NULL DEFAULT 'SKIP_NO_ITA',
    "lastSpaceCheckAt" DATETIME,
    "cachedFreeSpaceBytes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable Upload
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mediaInfo" TEXT,
    "hasItalianAudio" BOOLEAN NOT NULL DEFAULT false,
    "hasItalianSubtitles" BOOLEAN NOT NULL DEFAULT false,
    "serverId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressBytes" INTEGER NOT NULL DEFAULT 0,
    "currentRetryCount" INTEGER NOT NULL DEFAULT 0,
    "retryStrategy" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Upload_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Upload_status_idx" ON "Upload"("status");
CREATE INDEX "Upload_serverId_idx" ON "Upload"("serverId");
CREATE INDEX "Server_name_idx" ON "Server"("name");
