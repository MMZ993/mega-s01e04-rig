import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InvalidNightError, isMissingNightError, readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const validEvent = { at: '2026-10-28T23:00:00+01:00', job: 'job', owner: null, status: 'ok' };

/** Create an isolated temporary log; never write to the repository's real runs directory. */
async function fixture(contents: string, date = night): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rig-reader-'));
  await writeFile(join(dir, `${date}.jsonl`), contents);
  return dir;
}

describe('nightly run reader', () => {
  it('reads the real night as five sorted jobs while counting its malformed line', async () => {
    const digest = await readNight('runs', '2026-10-28');

    expect(digest.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows.find((row) => row.job === 'fixtures/refresh')).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00', hasFailure: false,
    });
    expect(digest.rows.find((row) => row.job === 'digest/render')?.owner).toBeNull();
  });

  it('aggregates by timestamp rather than file order while preserving offsets and recovered failures', async () => {
    const events = [
      { at: '2026-10-29T01:30:00+01:00', status: 'ok', owner: 'latest' },
      { at: '2026-10-28T23:00:00Z', status: 'fail', owner: null, error: 'old failure' },
      { at: '2026-10-29T00:00:00+00:00', status: 'retry', owner: 'retry', error: 'new error' },
      { at: '2026-10-29T02:00:00+02:00', status: 'retry', owner: 'retry', error: '  ' },
    ].map((event) => JSON.stringify({ ...event, job: 'job' }));
    const dir = await fixture(events.join('\n'));

    expect(await readNight(dir, night)).toEqual({
      night,
      rows: [{
        job: 'job', owner: 'latest', runs: 4, retries: 2, lastStatus: 'ok',
        lastError: 'new error', firstAt: '2026-10-28T23:00:00Z',
        lastAt: '2026-10-29T01:30:00+01:00', hasFailure: true,
      }],
      badLines: 0,
      counts: { ok: 1, retry: 2, fail: 1 },
    });
  });

  it('uses later line order to break equal-instant ties, including a null latest owner', async () => {
    const dir = await fixture([
      JSON.stringify({ ...validEvent, owner: 'first', status: 'fail', error: 'first error' }),
      JSON.stringify({ ...validEvent, at: '2026-10-28T22:00:00Z', error: 'last error' }),
    ].join('\n'));

    const { rows } = await readNight(dir, night);
    expect(rows[0]).toMatchObject({
      owner: null, lastStatus: 'ok', lastError: 'last error', hasFailure: true,
      firstAt: validEvent.at, lastAt: '2026-10-28T22:00:00Z',
    });
  });

  it('sorts case, unicode, and prototype-like job names without locale or object-key effects', async () => {
    const jobs = ['ä', 'constructor', 'a', '__proto__', 'Z'];
    const dir = await fixture(jobs.map((job) => JSON.stringify({ ...validEvent, job })).join('\n'));

    expect((await readNight(dir, night)).rows.map((row) => row.job))
      .toEqual(['Z', '__proto__', 'a', 'constructor', 'ä']);
  });

  it.each(['', '\n \t\r\n\n'])('renders an empty or whitespace-only log as no runs: %j', async (text) => {
    const dir = await fixture(text);
    expect(await readNight(dir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['null', 'null'],
    ['array', '[]'],
    ['primitive', 'true'],
    ['missing job', JSON.stringify({ at: validEvent.at, owner: null, status: 'ok' })],
    ['blank job', JSON.stringify({ ...validEvent, job: '  ' })],
    ['non-string job', JSON.stringify({ ...validEvent, job: 1 })],
    ['missing owner', JSON.stringify({ at: validEvent.at, job: 'job', status: 'ok' })],
    ['non-string owner', JSON.stringify({ ...validEvent, owner: 1 })],
    ['missing status', JSON.stringify({ at: validEvent.at, job: 'job', owner: null })],
    ['unknown status', JSON.stringify({ ...validEvent, status: 'success' })],
    ['non-string error', JSON.stringify({ ...validEvent, error: null })],
    ['missing timestamp', JSON.stringify({ job: 'job', owner: null, status: 'ok' })],
    ['non-string timestamp', JSON.stringify({ ...validEvent, at: 123 })],
    ['impossible calendar timestamp', JSON.stringify({ ...validEvent, at: '2026-02-30T23:00:00Z' })],
    ['timestamp without zone', JSON.stringify({ ...validEvent, at: '2026-10-28T23:00:00' })],
    ['date without time', JSON.stringify({ ...validEvent, at: '2026-10-28' })],
    ['hour overflow', JSON.stringify({ ...validEvent, at: '2026-10-28T24:00:00Z' })],
    ['minute overflow', JSON.stringify({ ...validEvent, at: '2026-10-28T23:60:00Z' })],
    ['second overflow', JSON.stringify({ ...validEvent, at: '2026-10-28T23:00:60Z' })],
    ['zone overflow', JSON.stringify({ ...validEvent, at: '2026-10-28T23:00:00+24:00' })],
  ])('counts %s as one bad line without losing adjacent valid events', async (_label, line) => {
    const dir = await fixture(`${line}\r\n\r\n${JSON.stringify(validEvent)}\r\n`);
    const digest = await readNight(dir, night);

    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0].runs).toBe(1);
  });

  it('preserves fractional timestamps, negative offsets, and the original nonempty error', async () => {
    const at = '2024-02-29T21:00:00.123-05:30';
    const dir = await fixture(JSON.stringify({ ...validEvent, at, error: ' error ' }));
    expect((await readNight(dir, night)).rows[0]).toMatchObject({ firstAt: at, lastAt: at, lastError: ' error ' });
  });

  it.each([
    ['0001', '0002'], ['000123', '0001234'], ['00009', '0001'],
  ])('orders submillisecond fractions %s and %s by their full precision', async (first, last) => {
    const firstAt = `2026-10-28T23:00:00.${first}+01:00`;
    const lastAt = `2026-10-28T23:00:00.${last}+01:00`;
    const dir = await fixture([
      JSON.stringify({ ...validEvent, at: lastAt }),
      JSON.stringify({ ...validEvent, at: firstAt, status: 'retry' }),
    ].join('\n'));
    expect((await readNight(dir, night)).rows[0]).toMatchObject({ firstAt, lastAt, lastStatus: 'ok' });
  });

  it('treats fractions with trailing zeroes as the same instant, preserving line-order ties', async () => {
    const firstAt = '2026-10-28T23:00:00.00010+01:00';
    const lastAt = '2026-10-28T22:00:00.0001Z';
    const dir = await fixture([
      JSON.stringify({ ...validEvent, at: firstAt }),
      JSON.stringify({ ...validEvent, at: lastAt, status: 'retry' }),
    ].join('\n'));
    expect((await readNight(dir, night)).rows[0]).toMatchObject({ firstAt, lastAt, lastStatus: 'retry' });
  });

  it('accepts leap days in calendar years divisible by 400', async () => {
    const date = '2000-02-29';
    const dir = await fixture('', date);
    expect((await readNight(dir, date)).night).toBe(date);
  });

  it.each([
    '../2026-10-28', '2026-10-28/../../secret', '/2026-10-28', '2026-1-01',
    '2026-01-1', '2026-00-01', '2026-13-01', '2026-01-00', '2026-04-31',
    '2026-02-29', '1900-02-29', '2026-10-28.jsonl', '2026-10-28\n', '',
  ])('rejects invalid night %j before filesystem access', async (date) => {
    await expect(readNight('/does-not-exist', date)).rejects.toBeInstanceOf(InvalidNightError);
  });

  it('leaves a missing night recognizable as ENOENT', async () => {
    const dir = await fixture('');
    const error = await readNight(dir, '2026-10-27').catch((error: unknown) => error);
    expect(isMissingNightError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'ENOENT' });
  });

  it('propagates unexpected filesystem errors instead of treating them as a missing or empty night', async () => {
    const dir = await fixture('');
    await mkdir(join(dir, '2026-10-27.jsonl'));
    const error = await readNight(dir, '2026-10-27').catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'EISDIR' });
    expect(isMissingNightError(error)).toBe(false);
  });

  it('does not classify invalid input or arbitrary values as a missing night', () => {
    expect(isMissingNightError(new InvalidNightError('../secret'))).toBe(false);
    expect(isMissingNightError(null)).toBe(false);
    expect(isMissingNightError({ code: 'ENOENT' })).toBe(false);
  });
});
