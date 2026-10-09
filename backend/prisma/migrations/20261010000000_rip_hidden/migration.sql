-- AlterTable: skipped rips removed from the list (kept so the downloads scan doesn't list them again)
ALTER TABLE "Rip" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
