/**
 * The refund policy markdown, loaded once. Single source for both the system
 * prompt and the /api/policy endpoint so the wording never drifts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = fileURLToPath(new URL('../../../data/refund-policy.md', import.meta.url));

export const POLICY_MARKDOWN = readFileSync(POLICY_PATH, 'utf8');
