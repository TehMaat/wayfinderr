/**
 * The film of a rip chosen by hand (issue #76): saved without ripping, kept on
 * Retry. Pure helpers, used by the Ripper (index.ts).
 */
import type { Rip } from '@prisma/client';

/**
 * What Retry clears of the film: everything when it was found automatically (it
 * is looked up again after the scan), nothing when it was chosen by hand.
 */
export const retryFilmFields = (rip: Pick<Rip, 'filmChosen'>) =>
  rip.filmChosen
    ? {}
    : {
        tmdbId: null,
        title: null,
        originalTitle: null,
        originalLanguage: null,
        year: null,
        secondLanguage: null,
      };

export const SAVED_REASON = 'Film saved: rip it from Choose… when you want';

/**
 * The reason of a rip waiting for a choice once its film is saved without ripping:
 * the film is no longer missing, what is still unsure about the title (if anything) is.
 */
export const savedReason = (titleProblems: string[]) =>
  titleProblems.length > 0 ? `Film saved · ${titleProblems.join(' · ')}` : SAVED_REASON;
