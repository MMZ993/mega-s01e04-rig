import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBoard } from '../src/views/status.js';

describe('board digest links', () => {
  it('links both nights with their own ok, retry, and fail event counts', () => {
    const status = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      lastBeat: null,
      nights: ['2026-10-28', '2026-10-27'],
      nightCounts: {
        '2026-10-28': { ok: 3, retry: 2, fail: 1 },
        '2026-10-27': { ok: 0, retry: 0, fail: 0 },
      },
    };

    const html = StatusBoard({ status }).toString();

    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('3 ok / 2 retry / 1 fail');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('0 ok / 0 retry / 0 fail');
  });

  it('keeps the empty-board message when there are no nights', () => {
    const html = StatusBoard({ status: {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      lastBeat: null,
      nights: [],
      nightCounts: {},
    } }).toString();

    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

/** Create isolated board configuration; teardown removes the temporary directory after the test. */
async function temporaryConfig() {
  const runsDir = await mkdtemp(join(tmpdir(), 'rig-board-'));
  temporaryDirectories.push(runsDir);
  return {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
}

describe('board event counts', () => {
  it('uses all valid events, not job totals or final status, and includes empty nights', async () => {
    const { readStatus } = await import('../src/status.js');
    const config = await temporaryConfig();
    const events = ['retry', 'fail', 'retry', 'ok', 'ok'].map((status) => JSON.stringify({
      at: '2026-10-28T10:00:00+01:00',
      job: 'recovered-job',
      owner: null,
      status,
    }));
    await writeFile(join(config.runsDir, '2026-10-28.jsonl'), [...events, 'not JSON'].join('\n'));
    await writeFile(join(config.runsDir, '2026-10-27.jsonl'), '');
    await writeFile(join(config.runsDir, 'notes.txt'), 'not a night');

    const status = await readStatus(config);

    expect(status.nights).toEqual(['2026-10-28', '2026-10-27']);
    expect(status.nightCounts).toEqual({
      '2026-10-28': { ok: 2, retry: 2, fail: 1 },
      '2026-10-27': { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('propagates filesystem errors instead of presenting an empty board', async () => {
    const { readStatus } = await import('../src/status.js');
    const config = await temporaryConfig();
    const notDirectory = join(config.runsDir, 'not-a-directory');
    await writeFile(notDirectory, '');

    await expect(readStatus({ ...config, runsDir: notDirectory })).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('preserves an empty board for a missing runs directory', async () => {
    const { readStatus } = await import('../src/status.js');
    const config = await temporaryConfig();

    const status = await readStatus({ ...config, runsDir: join(config.runsDir, 'missing') });

    expect(status.nights).toEqual([]);
    expect(status.nightCounts).toEqual({});
  });
});
