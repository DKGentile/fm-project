/**
 * Seed Postgres CRM tables from data/crm.json.
 *
 * Usage:
 *   CRM_BACKEND=postgres DATABASE_URL=postgresql://... npm -w server run seed:postgres
 */

import { config } from '../config.js';
import { loadRawCrm } from './anchor.js';
import { closePostgresPool, replacePostgresCrm } from './postgres.js';

if (!config.databaseUrl) {
  console.error('DATABASE_URL is required to seed Postgres.');
  process.exit(1);
}

// Seed RAW (anchor-relative) dates; both backends re-anchor onto today at read time.
const customers = loadRawCrm();

try {
  await replacePostgresCrm(customers);
  const orderCount = customers.reduce((sum, c) => sum + c.orders.length, 0);
  const itemCount = customers.reduce(
    (sum, c) => sum + c.orders.reduce((n, o) => n + o.items.length, 0),
    0,
  );
  console.log(`Seeded ${customers.length} customers, ${orderCount} orders, ${itemCount} line items.`);
} finally {
  await closePostgresPool();
}

