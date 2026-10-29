import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { createDigestPage } from './digest/page.js';
import { createDigestJson } from './digest/json.js';
import { readStatus } from './status.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

/** Create the loopback service routes using the supplied run directory; never mutate logs. */
export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.route('/digest', createDigestPage(config));
  app.route('/api/digest', createDigestJson(config));

  app.get('/', async (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={await readStatus(config)} />
      </Layout>,
    ),
  );

  return app;
}
