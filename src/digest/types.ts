/** Aggregated events for one job; timestamps retain their original log offsets. */
export type DigestRow = {
  job: string
  owner: string | null
  runs: number
  retries: number
  lastStatus: 'ok' | 'retry' | 'fail'
  lastError: string | null
  firstAt: string
  lastAt: string
  hasFailure: boolean
}

/** One night's sorted job rows, rejected-line count, and valid event counts. */
export type NightDigest = {
  night: string
  rows: DigestRow[]
  badLines: number
  counts: { ok: number; retry: number; fail: number }
}

/**
 * Read runsDir/<night>.jsonl without modifying it; reject invalid calendar nights,
 * preserve ENOENT for missing files, and propagate unexpected filesystem errors.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigest>
