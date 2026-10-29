import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { DigestRow, NightDigest } from '../src/digest/types.js';
import { DigestView } from '../src/views/digest.js';
import { Layout } from '../src/views/layout.js';

/** Render shared digest data through Hono JSX without a filesystem reader dependency. */
async function renderDigest(digest: NightDigest): Promise<string> {
  const app = new Hono();
  app.get('/', (c) => c.html(
    <Layout title="digest" lane={{ id: 'test-lane', marker: 'TEST-MARKER' }}>
      <DigestView digest={digest} />
    </Layout>,
  ));
  return (await app.request('/')).text();
}

const emptyDigest: NightDigest = {
  night: '2026-10-28',
  rows: [],
  badLines: 0,
  counts: { ok: 0, retry: 0, fail: 0 },
};

const recoveredRow: DigestRow = {
  job: 'alpha',
  owner: null,
  runs: 3,
  retries: 0,
  lastStatus: 'ok',
  lastError: 'connection refused',
  firstAt: '2026-10-28T23:10:00+02:00',
  lastAt: '2026-10-29T01:20:00+02:00',
  hasFailure: true,
};

describe('digest page rendering', () => {
  it('says nothing ran for an empty night', async () => {
    expect(await renderDigest(emptyDigest)).toContain('nothing ran');
  });

  it('uses the usual lane layout and one table in shared job order', async () => {
    const html = await renderDigest({
      ...emptyDigest,
      rows: [recoveredRow, { ...recoveredRow, job: 'beta', owner: 'ops', lastError: null }],
    });
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('test-lane');
    expect(html.match(/<table>/g)).toHaveLength(1);
    expect(html.indexOf('<td>alpha</td>')).toBeLessThan(html.indexOf('<td>beta</td>'));
    expect(html.match(/<td>—<\/td>/g)).toHaveLength(2);
    expect(html).toContain('<td>ops</td>');
    expect(html).toContain('<td>3</td>');
    expect(html).toContain('<td>connection refused</td>');
    expect(html).toContain(recoveredRow.firstAt);
    expect(html).toContain(recoveredRow.lastAt);
    expect(html).not.toContain('<script');
  });

  it('marks recovered failures and retries starting at three, not two', async () => {
    const html = await renderDigest({
      ...emptyDigest,
      rows: [
        recoveredRow,
        { ...recoveredRow, job: 'beta', retries: 2, hasFailure: false },
        { ...recoveredRow, job: 'gamma', retries: 3, hasFailure: false },
      ],
    });
    expect(html.match(/<tr class="warn">/g)).toHaveLength(2);
    expect(html).toContain('ok<span class="warn"> · failure recorded</span>');
    expect(html.match(/failure recorded/g)).toHaveLength(1);
    expect(html).toContain('<td>2</td>');
    expect(html).not.toContain('<td class="warn">2</td>');
    expect(html).toContain('<td class="warn">3</td>');
  });

  it('shows the rejected-line count even when no valid events ran', async () => {
    const html = await renderDigest({ ...emptyDigest, badLines: 2 });
    expect(html).toContain('<p class="warn">bad lines: 2</p>');
    expect(html).toContain('nothing ran');
  });

  it('escapes untrusted sample strings rather than emitting active HTML', async () => {
    const html = await renderDigest({
      ...emptyDigest,
      night: '<b>night</b>',
      rows: [{
        ...recoveredRow,
        job: '<script>job()</script>',
        owner: '<img src=x onerror=alert(1)>',
        lastError: '<svg onload=alert(1)> & failure',
      }],
    });
    expect(html).toContain('&lt;b&gt;night&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;job()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;svg onload=alert(1)&gt; &amp; failure');
    expect(html).not.toMatch(/<(script|img|svg|b)[\s>]/);
  });
});
