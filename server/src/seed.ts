// Seeds the database with the demo course (see demoData.ts).
//   npm run seed            -> seeds data/kks.db if it is empty
//   npm run seed -- --reset -> wipes and re-seeds

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './core';
import { db, openDb } from './db';
import { seedDemoData } from './demoData';

const PASSWORD = process.env.SEED_PASSWORD ?? 'kks12345';
const dbPath = join(config.dataDir, 'kks.db');

if (process.argv.includes('--reset') && existsSync(dbPath)) {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) rmSync(f);
}
openDb(dbPath);
if (db().get<{ n: number }>('SELECT count(*) AS n FROM users')!.n > 0) {
  console.log('Database already has data. Use "npm run seed -- --reset" to start over.');
  process.exit(0);
}

const counts = seedDemoData(PASSWORD);
console.log(`Seeded demo course: ${counts.tasks} tasks, ${counts.weeks} weeks, ${counts.events} schedule events.`);
console.log(`Log in as "mefaked" (commander) or "mefakatz1".."mefakatz5" (staff), password "${PASSWORD}".`);
