/**
 * Identifier generation for audit artifacts (escalation tickets, refund
 * confirmations). Centralised so the format lives in one place.
 */

let escalationCounter = 4200;

export function nextEscalationTicket(): string {
  return `ESC-${++escalationCounter}`;
}

export function refundConfirmationId(orderId: string): string {
  return `RFND-${orderId}-${Math.floor(100000 + (Date.now() % 900000))}`;
}
