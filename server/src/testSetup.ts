/**
 * Test preload. Force the hermetic JSON backend so the unit suite never depends
 * on a reachable Postgres/RDS (or its TLS). Import this FIRST in every test file:
 * ESM evaluates it before config.ts loads .env, and dotenv won't override an env
 * var that's already set — so CRM_BACKEND stays "json" no matter what .env says.
 */
process.env.CRM_BACKEND = 'json';
