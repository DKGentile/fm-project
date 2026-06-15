/**
 * Loads the repo-root .env regardless of which workspace directory the process
 * was started from. Import this FIRST, before any module that reads process.env.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
