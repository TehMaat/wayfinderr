-- Hold for merge by hand (issue #53): a flag on the rip, and pairs planned before their files arrive
ALTER TABLE "Rip" ADD COLUMN "holdForMerge" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MergePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "hashA" TEXT,
    "nameA" TEXT,
    "labelA" TEXT,
    "uploadAId" TEXT,
    "hashB" TEXT,
    "nameB" TEXT,
    "labelB" TEXT,
    "uploadBId" TEXT,
    "tmdbId" INTEGER,
    "originalLanguage" TEXT,
    "origin" TEXT,
    "pairId" TEXT,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "MergePlan_status_idx" ON "MergePlan"("status");
