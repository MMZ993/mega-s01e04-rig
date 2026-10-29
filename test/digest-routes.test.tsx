import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const fixturesDir = fileURLToPath(new URL('../runs/', import.meta.url));
let fixturesBefore: Map<string, Buffer>;
let tempDir: string;
let runsDir: string;

type RunEvent = {
  at: string;
  job: string;
  status: 'ok' | 'retry' | 'fail';
  owner: string | null;
  error?: string;
};

/** Read fixture bytes without changing the repository's read-only run logs. */
async function snapshotFixtures(): Promise<Map<string, Buffer>> {
  const files = (await readdir(fixturesDir)).sort();
  const snapshots = new Map<string, Buffer>();
  for (const file of files) {
    snapshots.set(file, await readFile(join(fixturesDir, file)));
  }
  return snapshots;
}

/** Build deterministic sample events, retaining the log's explicit time offset. */
function event(job: string, status: RunEvent['status'] = 'ok', minute = 0, owner: string | null = 'sample'): RunEvent {
  return { at: `2026-10-28T04:${String(minute).padStart(2, '0')}:00+01:00`, job, status, owner };
}

/** Write only this test's JSONL file; optional raw lines exercise malformed input. */
async function writeNight(events: RunEvent[], extraLines: string[] = []): Promise<void> {
  const lines = [...events.map((entry) => JSON.stringify(entry)), ...extraLines];
  await writeFile(join(runsDir, `${night}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');
}

/** Create the actual application with an isolated runs directory, without mocking reads. */
function appForNight() {
  return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
}

/** Extract server-rendered data rows, excluding the table's header row. */
function dataRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(([row]) => row)
    .filter((row) => /<td\b/i.test(row));
}

/** Read visible cell text from simple table markup; sample job names need no entity decoding. */
function cellTexts(row: string): string[] {
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map(([, cell]) => cell.replace(/<[^>]*>/g, '').trim());
}

/** Capture the real fixtures before any route calls so teardown can prove byte preservation. */
beforeAll(async () => {
  fixturesBefore = await snapshotFixtures();
});

/** Ensure route tests neither edit fixture bytes nor add or remove fixture files. */
afterAll(async () => {
  expect(await snapshotFixtures()).toEqual(fixturesBefore);
});

/** Create a writable runs directory and a private sibling area for traversal tests. */
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  runsDir = join(tempDir, 'runs');
  await mkdir(runsDir);
});

/** Unlink only test-owned files and remove their empty directories, never recursively. */
afterEach(async () => {
  for (const file of await readdir(runsDir)) {
    await unlink(join(runsDir, file));
  }
  await rmdir(runsDir);
  for (const file of await readdir(tempDir)) {
    await unlink(join(tempDir, file));
  }
  await rmdir(tempDir);
});

/** Verify HTML and JSON through public requests against real temporary run logs. */
describe('digest routes', () => {
  it('serves an existing night as HTML', async () => {
    await writeNight([event('alpha')]);
    const response = await appForNight().request(`/digest/${night}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('alpha');
  });

  it('serves the same sorted jobs in HTML and the NightDigest JSON object', async () => {
    await writeNight([event('zeta'), event('alpha', 'ok', 1), event('middle', 'ok', 2)]);
    const app = appForNight();
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    const html = await htmlResponse.text();
    const digest: NightDigest = await jsonResponse.json();
    expect(digest).toMatchObject({ night, badLines: 0, counts: { ok: 3, retry: 0, fail: 0 } });
    expect(digest.rows.map((row) => row.job)).toEqual(['alpha', 'middle', 'zeta']);
    expect((html.match(/<table\b/gi) ?? []).length).toBe(1);
    expect(dataRows(html).map((row) => cellTexts(row)[0])).toEqual(digest.rows.map((row) => row.job));
  });

  it.each(['/digest', '/api/digest'])('returns 404 for a missing night at %s', async (prefix) => {
    const response = await appForNight().request(`${prefix}/${night}`);
    expect(response.status).toBe(404);
  });

  it('renders nothing ran and returns an empty digest for an empty file', async () => {
    await writeNight([]);
    const app = appForNight();
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(await htmlResponse.text()).toMatch(/nothing ran/i);
    expect(await jsonResponse.json()).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps valid events on both sides of a malformed line and reports badLines', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), [
      JSON.stringify(event('zeta')),
      '{not valid json',
      JSON.stringify(event('alpha', 'retry', 1)),
      '',
    ].join('\n'));
    const app = appForNight();
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const digest: NightDigest = await jsonResponse.json();
    expect(digest.badLines).toBe(1);
    expect(digest.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(digest.rows.map((row) => row.job)).toEqual(['alpha', 'zeta']);
    expect(dataRows(await htmlResponse.text()).map((row) => cellTexts(row)[0]))
      .toEqual(digest.rows.map((row) => row.job));
  });

  it('retains a null owner as an em dash in HTML and null in JSON', async () => {
    await writeNight([event('unowned', 'ok', 0, null)]);
    const app = appForNight();
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const rows = dataRows(await htmlResponse.text());
    expect(rows).toHaveLength(1);
    expect(cellTexts(rows[0])).toContain('—');
    const digest: NightDigest = await jsonResponse.json();
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ job: 'unowned', owner: null });
  });

  it('highlights three retries and a past failure even after recovery, but not a healthy job', async () => {
    await writeNight([
      event('retried', 'retry', 0),
      event('retried', 'retry', 1),
      event('retried', 'retry', 2),
      event('retried', 'ok', 3),
      { ...event('recovered', 'fail', 4), error: 'sample outage' },
      event('recovered', 'ok', 5),
      event('healthy', 'ok', 6),
      event('two-retries', 'retry', 7),
      event('two-retries', 'retry', 8),
      event('two-retries', 'ok', 9),
    ]);
    const app = appForNight();
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const rows = new Map(dataRows(await htmlResponse.text()).map((row) => [cellTexts(row)[0], row]));
    const warning = /class=["'][^"']*\bwarn\b[^"']*["']/;
    expect(rows.get('retried')).toMatch(warning);
    expect(rows.get('recovered')).toMatch(warning);
    expect(rows.get('healthy')).toBeDefined();
    expect(rows.get('healthy')).not.toMatch(warning);
    expect(rows.get('two-retries')).toBeDefined();
    expect(rows.get('two-retries')).not.toMatch(warning);
    const digest: NightDigest = await jsonResponse.json();
    expect(digest.counts).toEqual({ ok: 4, retry: 5, fail: 1 });
    expect(digest.rows.find((row) => row.job === 'retried')).toEqual({
      job: 'retried', owner: 'sample', runs: 4, retries: 3, lastStatus: 'ok',
      lastError: null, firstAt: '2026-10-28T04:00:00+01:00', lastAt: '2026-10-28T04:03:00+01:00', hasFailure: false,
    });
    expect(digest.rows.find((row) => row.job === 'recovered')).toEqual({
      job: 'recovered', owner: 'sample', runs: 2, retries: 0, lastStatus: 'ok',
      lastError: 'sample outage', firstAt: '2026-10-28T04:04:00+01:00', lastAt: '2026-10-28T04:05:00+01:00', hasFailure: true,
    });
  });

  it('escapes sample text as data, never executable HTML, while JSON retains the original text', async () => {
    const sample = {
      ...event('<script>sample()</script>', 'fail', 0, '<img src=x onerror=sample()>'),
      error: '<svg onload=sample()> & sample',
    };
    await writeNight([sample]);
    const app = appForNight();
    const htmlResponse = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain('&lt;script&gt;sample()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=sample()&gt;');
    expect(html).toContain('&lt;svg onload=sample()&gt; &amp; sample');
    expect(html).not.toMatch(/<(?:script|img|svg)\b/i);
    const digest: NightDigest = await jsonResponse.json();
    expect(digest.rows[0]).toMatchObject({ job: sample.job, owner: sample.owner, lastError: sample.error });
  });

  it.each(['/digest', '/api/digest'])('rejects invalid calendar nights at %s even if a file exists', async (prefix) => {
    const app = appForNight();
    for (const invalid of ['not-a-night', '2026-02-30', '2026-13-01', '2026-10-00']) {
      await writeFile(join(runsDir, `${invalid}.jsonl`), `${JSON.stringify(event('invalid-date-data'))}\n`);
      const response = await app.request(`${prefix}/${invalid}`);
      expect([400, 404]).toContain(response.status);
      expect(await response.text()).not.toContain('invalid-date-data');
    }
  });

  it.each(['/digest', '/api/digest'])('rejects encoded traversal at %s without exposing a sibling file', async (prefix) => {
    await writeFile(join(tempDir, `${night}.jsonl`), `${JSON.stringify(event('outside-runs-data'))}\n`);
    const app = appForNight();
    for (const encoded of [`%2e%2e%2f${night}`, `%2E%2E%2F${night}`, `%252e%252e%252f${night}`]) {
      const response = await app.request(`${prefix}/${encoded}`);
      expect([400, 404]).toContain(response.status);
      expect(await response.text()).not.toContain('outside-runs-data');
    }
  });
});
