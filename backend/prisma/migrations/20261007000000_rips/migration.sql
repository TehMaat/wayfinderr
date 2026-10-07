-- CreateTable
CREATE TABLE "Rip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourcePath" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "downloadName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "reason" TEXT,
    "discName" TEXT,
    "titles" TEXT,
    "titleIndex" INTEGER,
    "tmdbId" INTEGER,
    "title" TEXT,
    "originalTitle" TEXT,
    "originalLanguage" TEXT,
    "year" INTEGER,
    "jobId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "outputFile" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Rip_sourcePath_key" ON "Rip"("sourcePath");

-- CreateIndex
CREATE INDEX "Rip_status_idx" ON "Rip"("status");

