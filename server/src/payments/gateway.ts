/**
 * Simulated payment gateway.
 *
 * When config.flakyGateway is enabled, the FIRST charge attempt for any given
 * order fails with a transient error and subsequent attempts succeed — so the
 * agent's retry handling produces a visible trace in the reasoning logs (the
 * challenge asks to show where the agent handles failures / retries).
 */

import { config } from '../config.js';
import { refundConfirmationId } from '../utils/ids.js';

export class TransientGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientGatewayError';
  }
}

/** Orders that have already had their one simulated transient failure. */
const warmed = new Set<string>();

export interface GatewayReceipt {
  confirmation: string;
  amount: number;
  method: string;
  processedAt: string;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function chargeRefund(
  orderId: string,
  amount: number,
  method: string,
): Promise<GatewayReceipt> {
  await delay(180); // mimic a little network latency

  if (config.flakyGateway && !warmed.has(orderId)) {
    warmed.add(orderId);
    throw new TransientGatewayError(
      `Payment processor timeout while issuing refund for ${orderId} (HTTP 503). Safe to retry.`,
    );
  }

  return {
    confirmation: refundConfirmationId(orderId),
    amount,
    method,
    processedAt: new Date().toISOString(),
  };
}

/** Re-arm the flaky-failure demo (used by the reset endpoint). */
export function resetGateway(): void {
  warmed.clear();
}
