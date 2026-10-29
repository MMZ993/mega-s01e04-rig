# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Digest routes: `/digest/2026-10-28` (HTML) and `/api/digest/2026-10-28` (JSON).
Both use the same reader; the status board links available sample nights with event counts.
The unauthenticated service listens only on `127.0.0.1`.

See [preview publication](docs/preview.md) for command capture, security boundaries, and
replacing the temporary public copy without its marker. Never commit `.env` or previews.

Working on it with an agent: start at [AGENTS.md](AGENTS.md).
