-- AlterTable: discs of one film joined by hand, ripped one by one then appended with mkvmerge
ALTER TABLE "Rip" ADD COLUMN "joinId" TEXT;
ALTER TABLE "Rip" ADD COLUMN "joinPart" INTEGER;

-- CreateIndex
CREATE INDEX "Rip_joinId_idx" ON "Rip"("joinId");
