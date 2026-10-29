import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight } from './types.js';

/** A validated log event, with its original timestamp and numeric ordering key. */
type RunEvent = {
  at: string;
  atMs: number;
  job: string;
  owner: string | null;
  status: DigestRow['lastStatus'];
  error?: string;
};

/** Identifies an invalid night before any filesystem access can occur. */
export class InvalidNightError extends Error {
  /** Describe an invalid YYYY-MM-DD calendar night without accessing the filesystem. */
  constructor(night: string) {
    super(`Invalid night: ${night}`);
    this.name = 'InvalidNightError';
  }
}

/** Recognize a missing log (ENOENT); all other filesystem errors remain distinct. */
export function isMissingNightError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Check an exact Gregorian YYYY-MM-DD date, including leap days, without normalization. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/** Accept a calendar-valid zoned ISO timestamp, retaining the supplied offset for display. */
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && isCalendarDate(value.slice(0, 10))
    && Number.isFinite(Date.parse(value));
}

/** Parse one nonblank line at the boundary; malformed JSON or event fields return null. */
function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.job !== 'string' || event.job.trim().length === 0
    || !isTimestamp(event.at)
    || (typeof event.owner !== 'string' && event.owner !== null)
    || (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail')
    || ('error' in event && typeof event.error !== 'string')) return null;
  return {
    at: event.at,
    atMs: Date.parse(event.at),
    job: event.job,
    owner: event.owner,
    status: event.status,
    error: event.error as string | undefined,
  };
}

/** Recover fractional digits beyond milliseconds, normalized so equal fractions compare equally. */
function submillisecondDigits(at: string): string {
  const fraction = at.match(/\.(\d+)/)?.[1] ?? '';
  return fraction.slice(3).replace(/0+$/, '');
}

/** Order full-precision instants; stable sorting leaves exact ties in original line order. */
function compareEvents(left: RunEvent, right: RunEvent): number {
  const milliseconds = left.atMs - right.atMs;
  if (milliseconds !== 0) return milliseconds;
  const leftFraction = submillisecondDigits(left.at);
  const rightFraction = submillisecondDigits(right.at);
  return leftFraction < rightFraction ? -1 : leftFraction > rightFraction ? 1 : 0;
}

/** Sort jobs by code-unit order, independently of the machine's locale. */
function compareJobs(left: DigestRow, right: DigestRow): number {
  return left.job < right.job ? -1 : left.job > right.job ? 1 : 0;
}

/** Aggregate chronological events; latest owner wins and a nonempty error survives recovery. */
function aggregateEvents(events: RunEvent[]): DigestRow[] {
  const rows = new Map<string, DigestRow>();
  for (const event of events) {
    let row = rows.get(event.job);
    if (!row) {
      row = {
        job: event.job,
        owner: event.owner,
        runs: 0,
        retries: 0,
        lastStatus: event.status,
        lastError: null,
        firstAt: event.at,
        lastAt: event.at,
        hasFailure: false,
      };
      rows.set(event.job, row);
    }
    row.runs += 1;
    row.retries += event.status === 'retry' ? 1 : 0;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
    row.hasFailure ||= event.status === 'fail';
    if (event.error !== undefined && event.error.trim().length > 0) row.lastError = event.error;
  }
  return [...rows.values()].sort(compareJobs);
}

/**
 * Read one strict calendar night's JSONL without mutations. Blank lines are ignored;
 * invalid lines are counted. ENOENT and unexpected filesystem errors propagate.
 */
export const readNight: ReadNight = async (runsDir, night) => {
  if (!isCalendarDate(night)) throw new InvalidNightError(night);
  const text = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  const events: RunEvent[] = [];
  const digest: NightDigest = {
    night,
    rows: [],
    badLines: 0,
    counts: { ok: 0, retry: 0, fail: 0 },
  };
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    const event = parseEvent(line);
    if (event === null) {
      digest.badLines += 1;
    } else {
      events.push(event);
      digest.counts[event.status] += 1;
    }
  }
  events.sort(compareEvents);
  digest.rows = aggregateEvents(events);
  return digest;
};
