-- AlterTable: the .torrent of the tracker upload, and the source torrent's tracker
ALTER TABLE "Upload" ADD COLUMN "torrentTracker" TEXT;
ALTER TABLE "Upload" ADD COLUMN "remoteFound" BOOLEAN;
ALTER TABLE "Upload" ADD COLUMN "releaseTracker" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseTorrentName" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseTorrentPath" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseTorrentHash" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseTorrentData" BLOB;
