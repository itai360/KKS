import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { createUser } from './auth';
import { startScheduler } from './automation';
import { config } from './core';
import { openDb } from './db';
import { autoSnapshot } from './snapshots';

const db = openDb(join(config.dataDir, 'kks.db'));

// Optional bootstrap of the first commander account from the environment.
// Otherwise the first visit shows the "set up the course" screen.
const users = db.get<{ n: number }>('SELECT count(*) AS n FROM users')!.n;
if (users === 0 && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  createUser({
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
    displayName: process.env.ADMIN_NAME ?? 'מפקד הקורס',
    title: 'מפקד הקורס',
    role: 'commander',
  });
  console.log(`Created commander account "${process.env.ADMIN_USERNAME}"`);
}

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR ?? resolve(here, '../client');
const app = createApp({ staticDir });

startScheduler();
// a snapshot of the database every half hour while people work (settings -> backups)
setInterval(() => void autoSnapshot().catch((e) => console.error('[snapshots]', e)), 60_000).unref();

app.listen(config.port, () => {
  console.log(`KKS course manager listening on http://localhost:${config.port}`);
});
