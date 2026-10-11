-- AlterTable: the source torrent's .torrent, kept when added by hand
ALTER TABLE "Upload" ADD COLUMN "torrentFileName" TEXT;
ALTER TABLE "Upload" ADD COLUMN "torrentFileData" BLOB;
