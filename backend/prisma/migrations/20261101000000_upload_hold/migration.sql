-- Held for a merge (services/merge/hold.ts)
ALTER TABLE "Upload" ADD COLUMN "holdKind" TEXT;
ALTER TABLE "Upload" ADD COLUMN "holdMessage" TEXT;
