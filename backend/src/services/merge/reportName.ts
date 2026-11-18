/**
 * The name of a Dyadrr report saved from a pair (?download=1):
 * "<film> - <step> - <outcome> - <YYYY-MM-DD>.json", e.g.
 * "Sample Film (2004) - analyze - refused - 2026-11-17.json".
 * The job files keep their own names: only the downloaded file is named here.
 */
import { safeFileName } from '../ripper/index.js';
import { jobOutcome, type DyadrrReport } from './jobs.js';

export type ReportStep = 'analyze' | 'merge';

/**
 * The outcome in the name: the analysis's decision (eligible, refused, error, cancelled);
 * a merge is merged (the file delivered), cancelled (stopped) or failed (anything else).
 */
export const reportOutcome = (step: ReportStep, report: DyadrrReport): string => {
  const decision = jobOutcome(report);
  if (step === 'analyze' || decision === 'cancelled') return decision;
  const output = report.output as { delivered?: unknown } | null | undefined;
  return decision === 'eligible' && output?.delivered === true ? 'merged' : 'failed';
};

/** The report's day, in UTC: when it finished, else when it started; null without a valid date. */
export const reportDay = (report: DyadrrReport): string | null => {
  for (const value of [report.finishedAt, report.startedAt]) {
    if (typeof value !== 'string') continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
};

/** "<film> - <step> - <outcome> - <day>.json": the day is left out when the report has none. */
export const reportFileName = (film: string, step: ReportStep, report: DyadrrReport): string =>
  `${safeFileName([film, step, reportOutcome(step, report), reportDay(report)].filter(Boolean).join(' - '))}.json`;

// RFC 5987: what encodeURIComponent leaves as it is but a header value must not carry
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The Content-Disposition of a file to save (RFC 6266): an ASCII `filename` for the
 * browsers that read only that one (accents dropped, any other character as "_"), and
 * `filename*` in UTF-8 with the name as it is.
 */
export const attachmentHeader = (fileName: string): string => {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
};
