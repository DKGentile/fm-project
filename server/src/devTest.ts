/**
 * Local front-end testing entry. Forces the in-memory CRM (CRM_BACKEND=json) so
 * the whole app runs with ZERO AWS/Postgres — no RDS connection, no reseed —
 * which is handy for fast front-end iteration. Used by `npm run dev:test`.
 *
 * The env var is set BEFORE the real bootstrap is imported; dotenv won't
 * override an already-set variable, so this wins over whatever `.env` says.
 * (Dynamic import so the assignment runs first, before config/.env load.)
 */
process.env.CRM_BACKEND = 'json';
await import('./index.js');
