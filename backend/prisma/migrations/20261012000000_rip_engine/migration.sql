-- AlterTable: what rips the disc, MakeMKV or the backend's own remux (mkvmerge / ffmpeg) after a failed MakeMKV rip
ALTER TABLE "Rip" ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'makemkv';
