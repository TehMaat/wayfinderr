-- AlterTable: pause every torrent of a client while a local disk is low on space
ALTER TABLE "TorrentClient" ADD COLUMN "minFreeGB" REAL;
ALTER TABLE "TorrentClient" ADD COLUMN "spacePausedAt" DATETIME;
ALTER TABLE "TorrentClient" ADD COLUMN "spaceMessage" TEXT;
