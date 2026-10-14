-- Local release: a download client's machine (over SSH) as the release target of an upload
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TorrentClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "apiKey" TEXT,
    "category" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoRemove" BOOLEAN NOT NULL DEFAULT true,
    "deleteFiles" BOOLEAN NOT NULL DEFAULT false,
    "minFreeGB" REAL,
    "spacePausedAt" DATETIME,
    "spaceMessage" TEXT,
    "localRelease" BOOLEAN NOT NULL DEFAULT false,
    "sshHost" TEXT,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUsername" TEXT,
    "sshPassword" TEXT,
    "hostWatchDir" TEXT,
    "releaseDir" TEXT,
    "releaseTag" TEXT,
    "trackerCommand" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_TorrentClient" ("apiKey", "autoRemove", "category", "createdAt", "deleteFiles", "enabled", "id", "minFreeGB", "name", "password", "spaceMessage", "spacePausedAt", "updatedAt", "url", "username") SELECT "apiKey", "autoRemove", "category", "createdAt", "deleteFiles", "enabled", "id", "minFreeGB", "name", "password", "spaceMessage", "spacePausedAt", "updatedAt", "url", "username" FROM "TorrentClient";
DROP TABLE "TorrentClient";
ALTER TABLE "new_TorrentClient" RENAME TO "TorrentClient";
CREATE TABLE "new_Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mediaInfo" TEXT,
    "hasItalianAudio" BOOLEAN NOT NULL DEFAULT false,
    "hasItalianSubtitles" BOOLEAN NOT NULL DEFAULT false,
    "serverId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressBytes" BIGINT NOT NULL DEFAULT 0,
    "currentRetryCount" INTEGER NOT NULL DEFAULT 0,
    "retryStrategy" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "error" TEXT,
    "torrentStatus" TEXT,
    "torrentClientId" TEXT,
    "torrentHash" TEXT,
    "torrentName" TEXT,
    "torrentScore" INTEGER,
    "torrentMessage" TEXT,
    "torrentTracker" TEXT,
    "torrentFileName" TEXT,
    "torrentFileData" BLOB,
    "localClientId" TEXT,
    "remotePath" TEXT,
    "remoteFound" BOOLEAN,
    "releaseStatus" TEXT,
    "releaseName" TEXT,
    "releasePrompt" TEXT,
    "releaseLog" TEXT,
    "releaseOffset" INTEGER NOT NULL DEFAULT 0,
    "releaseMessage" TEXT,
    "releaseStartedAt" DATETIME,
    "releaseCompletedAt" DATETIME,
    "releaseTracker" TEXT,
    "releaseTorrentName" TEXT,
    "releaseTorrentPath" TEXT,
    "releaseTorrentHash" TEXT,
    "releaseTorrentData" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Upload_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Upload_localClientId_fkey" FOREIGN KEY ("localClientId") REFERENCES "TorrentClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Upload" ("completedAt", "createdAt", "currentRetryCount", "error", "filename", "filepath", "hasItalianAudio", "hasItalianSubtitles", "id", "mediaInfo", "progress", "progressBytes", "releaseCompletedAt", "releaseLog", "releaseMessage", "releaseName", "releaseOffset", "releasePrompt", "releaseStartedAt", "releaseStatus", "releaseTorrentData", "releaseTorrentHash", "releaseTorrentName", "releaseTorrentPath", "releaseTracker", "remoteFound", "remotePath", "retryStrategy", "serverId", "size", "startedAt", "status", "torrentClientId", "torrentFileData", "torrentFileName", "torrentHash", "torrentMessage", "torrentName", "torrentScore", "torrentStatus", "torrentTracker", "updatedAt") SELECT "completedAt", "createdAt", "currentRetryCount", "error", "filename", "filepath", "hasItalianAudio", "hasItalianSubtitles", "id", "mediaInfo", "progress", "progressBytes", "releaseCompletedAt", "releaseLog", "releaseMessage", "releaseName", "releaseOffset", "releasePrompt", "releaseStartedAt", "releaseStatus", "releaseTorrentData", "releaseTorrentHash", "releaseTorrentName", "releaseTorrentPath", "releaseTracker", "remoteFound", "remotePath", "retryStrategy", "serverId", "size", "startedAt", "status", "torrentClientId", "torrentFileData", "torrentFileName", "torrentHash", "torrentMessage", "torrentName", "torrentScore", "torrentStatus", "torrentTracker", "updatedAt" FROM "Upload";
DROP TABLE "Upload";
ALTER TABLE "new_Upload" RENAME TO "Upload";
CREATE INDEX "Upload_status_idx" ON "Upload"("status");
CREATE INDEX "Upload_serverId_idx" ON "Upload"("serverId");
CREATE INDEX "Upload_torrentStatus_idx" ON "Upload"("torrentStatus");
CREATE INDEX "Upload_releaseStatus_idx" ON "Upload"("releaseStatus");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

