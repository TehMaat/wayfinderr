-- AlterTable: rename the uploaded file on the server, then upload it to the tracker
ALTER TABLE "Server" ADD COLUMN "releaseDir" TEXT NOT NULL DEFAULT 'downloads/qbittorrent';
ALTER TABLE "Server" ADD COLUMN "releaseTag" TEXT;
ALTER TABLE "Server" ADD COLUMN "trackerCommand" TEXT;
ALTER TABLE "Server" ADD COLUMN "releaseAuto" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Upload" ADD COLUMN "remotePath" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseStatus" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseName" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releasePrompt" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseLog" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseOffset" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Upload" ADD COLUMN "releaseMessage" TEXT;
ALTER TABLE "Upload" ADD COLUMN "releaseStartedAt" DATETIME;
ALTER TABLE "Upload" ADD COLUMN "releaseCompletedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Upload_releaseStatus_idx" ON "Upload"("releaseStatus");
