-- A source torrent's .torrent sent before its upload exists (services/sourceTorrents.ts)
CREATE TABLE "SourceTorrent" (
    "infoHash" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "size" BIGINT NOT NULL,
    "tracker" TEXT NOT NULL,
    "tmdbId" INTEGER,
    "label" TEXT,
    "origin" TEXT,
    "attachedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "SourceTorrent_name_idx" ON "SourceTorrent"("name");
