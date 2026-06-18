/**
 * Dev convenience: reset the Postgres CRM to a clean, freshly-seeded state.
 *
 * Runs automatically before `npm run dev` (root `predev`). It applies the
 * idempotent schema and reseeds the demo data (RAW anchor-relative dates), so
 * every dev session starts fresh — refunds, abuse counters, and claim state all
 * reset. Skips cleanly (and never blocks startup) when not using Postgres.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { loadRawCrm } from './anchor.js';
import { applySql, closePostgresPool, replacePostgresCrm } from './postgres.js';

const SCHEMA_PATH = fileURLToPath(new URL('../../../db/schema.sql', import.meta.url));

async function main(): Promise<void> {
  if (config.crmBackend !== 'postgres' || !config.databaseUrl) {
    console.log('  ▸ dev seed: CRM_BACKEND is not postgres — skipping DB reset (using in-memory data).');
    return;
  }

  await applySql(readFileSync(SCHEMA_PATH, 'utf8'));
  const customers = loadRawCrm();
  await replacePostgresCrm(customers);
  const orders = customers.reduce((n, c) => n + c.orders.length, 0);
  console.log(`  ▸ dev seed: schema applied + reseeded ${customers.length} customers / ${orders} orders (fresh demo data).`);
}

main()
  .catch((err) => {
    // Non-fatal: a seed failure shouldn't block `npm run dev`. The server's own
    // boot check will surface a real connectivity problem with a clear message.
    console.warn(`  ⚠ dev seed skipped: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(async () => {
    await closePostgresPool();
    process.exit(0);
  });
