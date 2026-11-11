-- Restart of the Ultra-API on the server (services/ultraApi.ts): by hand, or by itself when unreachable
ALTER TABLE "Server" ADD COLUMN "autoRestartApi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Server" ADD COLUMN "apiRestartAt" DATETIME;
ALTER TABLE "Server" ADD COLUMN "apiRestartError" TEXT;
