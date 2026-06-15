/**
 * Anthropic client + error helpers.
 *
 * We build the agent on raw Claude tool-calling (a manual agentic loop) so we
 * keep full control over streaming, retries, and the reasoning-event trace.
 * Model/effort/key configuration lives in ../config.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

// Construct with a placeholder when no key is set so the server still boots
// (the dashboard, CRM viewer, and config endpoint work without a key); agent
// requests then fail with a clear, surfaced auth error.
export const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey ?? 'NO_API_KEY_CONFIGURED',
  maxRetries: 0, // we handle retries ourselves so we can emit retry events
});

export function isRetryableApiError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    return status === 429 || status === 529 || (typeof status === 'number' && status >= 500);
  }
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `${err.name} (${err.status ?? 'no status'}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
