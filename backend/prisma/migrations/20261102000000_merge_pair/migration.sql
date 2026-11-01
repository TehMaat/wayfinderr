-- Two files of the same film merged with Dyadrr (services/merge/pairs.ts)
CREATE TABLE "MergePair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadAId" TEXT NOT NULL,
    "uploadBId" TEXT NOT NULL,
    "fileA" TEXT NOT NULL,
    "fileB" TEXT NOT NULL,
    "originalLanguage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ANALYZING',
    "jobId" TEXT,
    "phase" TEXT,
    "progress" INTEGER,
    "reasonCode" TEXT,
    "reasonMessage" TEXT,
    "report" TEXT,
    "dyadrrVersion" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "MergePair_status_idx" ON "MergePair"("status");
