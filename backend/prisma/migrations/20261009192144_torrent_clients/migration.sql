-- AlterTable
ALTER TABLE "Upload" ADD COLUMN "torrentClientId" TEXT;
ALTER TABLE "Upload" ADD COLUMN "torrentHash" TEXT;
ALTER TABLE "Upload" ADD COLUMN "torrentMessage" TEXT;
ALTER TABLE "Upload" ADD COLUMN "torrentName" TEXT;
ALTER TABLE "Upload" ADD COLUMN "torrentScore" INTEGER;
ALTER TABLE "Upload" ADD COLUMN "torrentStatus" TEXT;

-- CreateTable
CREATE TABLE "TorrentClient" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Upload_torrentStatus_idx" ON "Upload"("torrentStatus");
