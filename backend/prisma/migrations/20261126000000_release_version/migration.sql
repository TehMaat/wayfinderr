-- Version (edition) chosen beforehand (issue #108): null not chosen, "" none on purpose
ALTER TABLE "Upload" ADD COLUMN "version" TEXT;
ALTER TABLE "Rip" ADD COLUMN "version" TEXT;
ALTER TABLE "SourceTorrent" ADD COLUMN "version" TEXT;
ALTER TABLE "MergePlan" ADD COLUMN "version" TEXT;
