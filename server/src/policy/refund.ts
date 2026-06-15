/**
 * R6 / R11 — refund amount calculation (line subtotal minus any restocking fee).
 */

import type { OrderItem } from '@northwind/shared';
import { restockingFeeRateFor } from './rules.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface RefundCalculation {
  sku: string;
  lineSubtotal: number;
  restockingFeeRate: number;
  restockingFee: number;
  refundAmount: number;
  policyRefs: string[];
  note: string;
}

export function calculateRefund(item: OrderItem): RefundCalculation {
  const restockingFeeRate = restockingFeeRateFor(item);
  const lineSubtotal = round2(item.price * item.quantity);
  const restockingFee = round2(lineSubtotal * restockingFeeRate);
  const refundAmount = round2(lineSubtotal - restockingFee);
  return {
    sku: item.sku,
    lineSubtotal,
    restockingFeeRate,
    restockingFee,
    refundAmount,
    policyRefs: restockingFeeRate > 0 ? ['R6'] : ['R11'],
    note:
      restockingFeeRate > 0
        ? `$${lineSubtotal} subtotal − $${restockingFee} restocking fee = $${refundAmount}.`
        : `Full line subtotal of $${refundAmount} (no restocking fee).`,
  };
}
