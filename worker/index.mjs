// Local-dev startup. For Vercel, `api/[[...path]].mjs` mounts the Hono app directly.
// Run: PORT=8787 node worker/index.mjs

import { serve } from '@hono/node-server';
import { app } from './app.mjs';

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(`worker listening on http://0.0.0.0:${info.port}\n`);
});

export default app;
