import { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { DigestView } from '../views/digest.js';
import { Layout } from '../views/layout.js';
import { InvalidNightError, readNight } from './reader.js';

/**
 * Create the HTML router mounted at /digest, reading config.runsDir per request.
 * Render shared sorted rows with the lane banner; map invalid, missing and unexpected
 * read errors to 400, 404 and 500 without exposing filesystem paths or error details.
 */
export function createDigestPage(config: RigConfig): Hono {
  const app = new Hono();

  app.get('/:night', async (c) => {
    try {
      const digest = await readNight(config.runsDir, c.req.param('night'));
      return c.html(
        <Layout title={`digest · ${digest.night}`} lane={lane()}>
          <DigestView digest={digest} />
        </Layout>,
      );
    } catch (error) {
      if (error instanceof InvalidNightError) {
        return c.text('invalid night', 400);
      }
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        return c.text('night not found', 404);
      }
      return c.text('unable to read digest', 500);
    }
  });

  return app;
}
