import { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { InvalidNightError, readNight } from './reader.js';

/**
 * Create a JSON router for mounting at /api/digest using config.runsDir.
 * Return the shared reader's complete digest without transforming its rows.
 * Map invalid nights, missing files, and other read errors to safe HTTP errors;
 * never expose filesystem paths or modify run logs.
 */
export function createDigestJson(config: RigConfig): Hono {
  const app = new Hono();

  /** Read the requested night and serialize its digest or a path-free error. */
  app.get('/:night', async (c) => {
    try {
      const digest = await readNight(config.runsDir, c.req.param('night'));
      return c.json(digest);
    } catch (error: unknown) {
      if (error instanceof InvalidNightError) {
        return c.json({ error: 'Invalid night' }, 400);
      }
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return c.json({ error: 'Night not found' }, 404);
      }
      return c.json({ error: 'Unable to read night' }, 500);
    }
  });

  return app;
}
