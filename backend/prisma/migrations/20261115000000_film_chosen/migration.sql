-- Film saved without ripping (issue #76): a film chosen by hand is kept on Retry
ALTER TABLE "Rip" ADD COLUMN "filmChosen" BOOLEAN NOT NULL DEFAULT false;
