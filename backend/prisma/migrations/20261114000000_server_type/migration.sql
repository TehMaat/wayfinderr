-- Server types (issue #68): ULTRA (Ultra.cc, as every existing server), SEEDBOX, SSH; the Ultra-API endpoint and token become optional
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Server" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ULTRA',
    "apiEndpoint" TEXT,
    "apiToken" TEXT,
    "sshHost" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUsername" TEXT NOT NULL,
    "sshPassword" TEXT,
    "sshPath" TEXT NOT NULL DEFAULT '/uploads',
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "backoffStrategy" TEXT NOT NULL DEFAULT 'exponential',
    "mediaCheckPolicy" TEXT NOT NULL DEFAULT 'SKIP_NO_ITA',
    "releaseDir" TEXT NOT NULL DEFAULT 'downloads/qbittorrent',
    "releaseTag" TEXT,
    "trackerCommand" TEXT,
    "releaseAuto" BOOLEAN NOT NULL DEFAULT false,
    "autoRestartApi" BOOLEAN NOT NULL DEFAULT false,
    "apiRestartAt" DATETIME,
    "apiRestartError" TEXT,
    "lastSpaceCheckAt" DATETIME,
    "cachedFreeSpaceBytes" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Server" ("apiEndpoint", "apiRestartAt", "apiRestartError", "apiToken", "autoRestartApi", "backoffStrategy", "cachedFreeSpaceBytes", "createdAt", "id", "lastSpaceCheckAt", "maxRetries", "mediaCheckPolicy", "name", "releaseAuto", "releaseDir", "releaseTag", "sshHost", "sshPassword", "sshPath", "sshPort", "sshUsername", "trackerCommand", "updatedAt") SELECT "apiEndpoint", "apiRestartAt", "apiRestartError", "apiToken", "autoRestartApi", "backoffStrategy", "cachedFreeSpaceBytes", "createdAt", "id", "lastSpaceCheckAt", "maxRetries", "mediaCheckPolicy", "name", "releaseAuto", "releaseDir", "releaseTag", "sshHost", "sshPassword", "sshPath", "sshPort", "sshUsername", "trackerCommand", "updatedAt" FROM "Server";
DROP TABLE "Server";
ALTER TABLE "new_Server" RENAME TO "Server";
CREATE INDEX "Server_name_idx" ON "Server"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

