-- AlterTable: RAR archives in the downloads folder, unpacked before the rip or the upload
ALTER TABLE "Rip" ADD COLUMN "contentType" TEXT;
ALTER TABLE "Rip" ADD COLUMN "contentPath" TEXT;
ALTER TABLE "Rip" ADD COLUMN "unpackBytes" BIGINT;
ALTER TABLE "Rip" ADD COLUMN "unpackedTo" TEXT;
