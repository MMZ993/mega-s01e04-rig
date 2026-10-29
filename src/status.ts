import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { NightDigest } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: string[];
  nightCounts: Record<string, NightDigest['counts']>;
};

/** List dated run logs newest first; missing directories are empty, other errors propagate. */
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/** Read board state and each night's event counts; reader errors propagate without zero fallbacks. */
export async function readStatus(config: RigConfig): Promise<Status> {
  const nights = nightsOnDisk(config.runsDir);
  const nightCounts = Object.fromEntries(await Promise.all(nights.map(async (night) => {
    const digest = await readNight(config.runsDir, night);
    return [night, digest.counts] as const;
  })));

  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
    nightCounts,
  };
}
