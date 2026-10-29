import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDigestJson } from '../src/digest/json.js';

let runsDir: string;
let app: Hono;

/** Create an isolated runs directory and mount the JSON router for each request test. */
beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-json-'));
  app = new Hono();
  app.route('/api/digest', createDigestJson({
    adapter: 'test',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  }));
});

/** Remove only the temporary fixtures created by the current test. */
afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

describe('digest JSON route', () => {
  it('returns the complete sorted night digest, retaining recovery details and event counts', async () => {
    await writeFile(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'zeta', owner: null, status: 'fail', error: 'offline' }),
      JSON.stringify({ at: '2026-10-28T01:01:00+01:00', job: 'alpha', owner: 'Ada', status: 'retry' }),
      JSON.stringify({ at: '2026-10-28T01:02:00+01:00', job: 'zeta', owner: null, status: 'ok' }),
    ].join('\n'));

    const response = await app.request('/api/digest/2026-10-28');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      night: '2026-10-28',
      rows: [
        { job: 'alpha', owner: 'Ada', runs: 1, retries: 1, lastStatus: 'retry', lastError: null, firstAt: '2026-10-28T01:01:00+01:00', lastAt: '2026-10-28T01:01:00+01:00', hasFailure: false },
        { job: 'zeta', owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: 'offline', firstAt: '2026-10-28T01:00:00+01:00', lastAt: '2026-10-28T01:02:00+01:00', hasFailure: true },
      ],
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('returns an empty digest for an empty night', async () => {
    await writeFile(join(runsDir, '2026-10-28.jsonl'), '');

    const response = await app.request('/api/digest/2026-10-28');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed lines without rejecting the night', async () => {
    await writeFile(join(runsDir, '2026-10-28.jsonl'), [
      'not-json',
      JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'alpha', owner: null, status: 'ok' }),
    ].join('\n'));

    const response = await app.request('/api/digest/2026-10-28');
    const digest = await response.json();

    expect(response.status).toBe(200);
    expect(digest.badLines).toBe(1);
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0].job).toBe('alpha');
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('returns a path-free 404 for a missing night', async () => {
    const response = await app.request('/api/digest/2026-10-28');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Night not found' });
  });

  it.each(['not-a-night', '2026-02-30', '2026-10-28.jsonl', '..%2Fprivate'])('rejects invalid night %s with 400', async (night) => {
    const response = await app.request(`/api/digest/${night}`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid night' });
  });

  it('returns a path-free 500 for unexpected filesystem errors', async () => {
    await mkdir(join(runsDir, '2026-10-28.jsonl'));

    const response = await app.request('/api/digest/2026-10-28');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to read night' });
  });
});
