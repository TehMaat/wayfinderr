-- SSH host key of servers and download clients (issue #102): kept at the first connection,
-- checked at every other one
ALTER TABLE "Server" ADD COLUMN "sshHostKey" TEXT;
ALTER TABLE "TorrentClient" ADD COLUMN "sshHostKey" TEXT;
