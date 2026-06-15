/**
 * The server-side refund guardrail: aggregate every policy condition that blocks
 * a refund. process_refund calls this and refuses if anything blocks — so a
 * customer can't social-engineer the model into an ineligible refund.
 */

import type { Customer, Order, OrderItem } from '@northwind/shared';
import {
  checkCustomerStanding,
  checkHighValue,
  checkItemEligibility,
  checkReturnWindow,
} from '../../policy/rules.js';

export interface Blocker {
  code: string;
  reason: string;
  policyRefs: string[];
  /** Should route to a human rather than a plain denial. */
  escalate?: boolean;
}

export function assessBlockers(customer: Customer, order: Order, item: OrderItem): Blocker[] {
  const blockers: Blocker[] = [];

  const window = checkReturnWindow(order);
  if (!window.refundableStatus) {
    blockers.push({ code: 'status', reason: window.note, policyRefs: window.policyRefs });
  } else if (!window.withinWindow) {
    blockers.push({ code: 'window', reason: window.note, policyRefs: window.policyRefs });
  }

  const eligibility = checkItemEligibility(item, order);
  if (!eligibility.eligible) {
    blockers.push({
      code: 'item',
      reason: eligibility.reasons.join(' '),
      policyRefs: eligibility.policyRefs,
    });
  }

  const standing = checkCustomerStanding(customer);
  if (standing.requiresManager) {
    blockers.push({
      code: 'refund_abuse',
      reason: standing.note,
      policyRefs: standing.policyRefs,
      escalate: true,
    });
  }

  const highValue = checkHighValue(order);
  if (highValue.requiresManager) {
    blockers.push({
      code: 'high_value',
      reason: highValue.note,
      policyRefs: highValue.policyRefs,
      escalate: true,
    });
  }

  if (eligibility.requiresPhoto) {
    blockers.push({
      code: 'photo_required',
      reason: 'Photo evidence is required before refunding this defective item.',
      policyRefs: ['R8'],
    });
  }

  return blockers;
}

/** Which terminal tool the model should call when a refund is blocked. */
export function recommendedActionFor(blockers: Blocker[]): string {
  if (blockers.some((b) => b.escalate)) return 'escalate_to_human';
  if (blockers.some((b) => b.code === 'photo_required')) return 'request_photo_evidence';
  return 'deny_refund';
}
