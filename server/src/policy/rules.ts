/**
 * Refund policy rules — pure, side-effect-free validators.
 *
 * Keeping the rules here (not in the prompt) makes enforcement deterministic and
 * auditable, and lets us unit-test them independently of the LLM (rules.test.ts).
 * Each function maps to one or more numbered rules in data/refund-policy.md.
 */

import type { Customer, Order, OrderItem } from '@demitri/shared';
import { daysSince } from '../utils/dates.js';
import { FINAL_SALE_CATEGORIES, POLICY } from './constants.js';

// ───────────────────────── R1 / R2: window & status ─────────────────────────

export interface ReturnWindowResult {
  withinWindow: boolean;
  daysSinceDelivery: number | null;
  windowDays: number;
  status: Order['status'];
  /** True if the order is in a state that can be refunded at all (R2). */
  refundableStatus: boolean;
  note: string;
  policyRefs: string[];
}

export function checkReturnWindow(order: Order): ReturnWindowResult {
  const windowDays = POLICY.RETURN_WINDOW_DAYS;

  if (order.status === 'refunded') {
    return {
      withinWindow: false,
      daysSinceDelivery: order.deliveredDate ? daysSince(order.deliveredDate) : null,
      windowDays,
      status: order.status,
      refundableStatus: false,
      note: 'Order has already been refunded; no second refund may be issued.',
      policyRefs: ['R2'],
    };
  }
  if (order.status === 'cancelled') {
    return {
      withinWindow: false,
      daysSinceDelivery: null,
      windowDays,
      status: order.status,
      refundableStatus: false,
      note: 'Order was cancelled; there is nothing to refund.',
      policyRefs: ['R2'],
    };
  }
  if (order.status === 'processing' || order.status === 'shipped') {
    return {
      withinWindow: false,
      daysSinceDelivery: null,
      windowDays,
      status: order.status,
      refundableStatus: false,
      note: `Order is "${order.status}" and has not been delivered yet. Offer cancellation instead of a refund.`,
      policyRefs: ['R2'],
    };
  }

  // status === 'delivered'
  const daysSinceDelivery = order.deliveredDate ? daysSince(order.deliveredDate) : null;
  const withinWindow = daysSinceDelivery !== null && daysSinceDelivery <= windowDays;
  return {
    withinWindow,
    daysSinceDelivery,
    windowDays,
    status: order.status,
    refundableStatus: true,
    note: withinWindow
      ? `Delivered ${daysSinceDelivery} day(s) ago — within the ${windowDays}-day window.`
      : `Delivered ${daysSinceDelivery} day(s) ago — outside the ${windowDays}-day window.`,
    policyRefs: ['R1'],
  };
}

// ───────────────────────── R3–R8: item eligibility ─────────────────────────

export interface ItemEligibilityResult {
  sku: string;
  name: string;
  eligible: boolean;
  /** Refund needs a human first (defective>$100 without photo, etc.). */
  requiresPhoto: boolean;
  restockingFeeRate: number;
  reasons: string[];
  policyRefs: string[];
}

/** R6 restocking-fee rate for an item — depends only on condition + category. */
export function restockingFeeRateFor(item: OrderItem): number {
  return item.condition === 'opened' && item.category === 'electronics' ? POLICY.RESTOCKING_FEE_RATE : 0;
}

export function checkItemEligibility(item: OrderItem, order: Order): ItemEligibilityResult {
  const reasons: string[] = [];
  const policyRefs = new Set<string>();
  let eligible = true;
  let requiresPhoto = false;
  let restockingFeeRate = 0;

  // R3 — final sale categories / flags
  if (FINAL_SALE_CATEGORIES.has(item.category) || item.finalSale) {
    eligible = false;
    policyRefs.add('R3');
    reasons.push(
      `"${item.name}" is a final-sale item (${item.category}${item.finalSale ? ', flagged final sale' : ''}) and is not refundable.`,
    );
  }

  // R4 — digital goods
  if (item.category === 'digital') {
    if (item.digitalAccessed) {
      eligible = false;
      policyRefs.add('R4');
      reasons.push('Digital license has already been accessed/activated and is not refundable.');
    } else if (eligible) {
      policyRefs.add('R4');
      reasons.push('Digital license has not been accessed — eligible.');
    }
  }

  // R5 — condition (+ R8 photo proof, R6 restocking fee)
  switch (item.condition) {
    case 'damaged_by_customer':
      eligible = false;
      policyRefs.add('R5');
      reasons.push('Item was damaged by the customer; customer damage is not covered.');
      break;
    case 'defective':
      policyRefs.add('R5');
      reasons.push('Item is reported defective — eligible for a full refund with no restocking fee.');
      // R8 — proof for defective claims over $100 (evaluated on the line value,
      // consistent with the restocking-fee (R6) and high-value (R9) math).
      if (item.price * item.quantity > POLICY.PHOTO_REQUIRED_OVER) {
        policyRefs.add('R8');
        if (!order.photoEvidenceProvided) {
          requiresPhoto = true;
          reasons.push(
            `Defective claim over $${POLICY.PHOTO_REQUIRED_OVER} requires photo evidence, which has not been provided.`,
          );
        } else {
          reasons.push('Photo evidence for the defective claim is on file.');
        }
      }
      break;
    case 'opened':
      if (item.category === 'electronics') {
        restockingFeeRate = restockingFeeRateFor(item);
        policyRefs.add('R6');
        reasons.push(
          `Opened, undamaged electronics are eligible subject to a ${POLICY.RESTOCKING_FEE_RATE * 100}% restocking fee.`,
        );
      } else {
        policyRefs.add('R5');
        reasons.push('Opened, undamaged non-electronics item is eligible at full value (no restocking fee).');
      }
      break;
    case 'used':
      eligible = false;
      policyRefs.add('R5');
      reasons.push('Item is recorded as used (beyond inspection); used items are not eligible for a standard refund.');
      break;
    case 'new':
    default:
      break;
  }

  // R7 — consumables over 50% used (scoped to consumable/perishable goods)
  if (
    (item.category === 'consumable' || item.category === 'perishable') &&
    typeof item.usagePercent === 'number' &&
    item.usagePercent > POLICY.CONSUMABLE_MAX_USAGE
  ) {
    eligible = false;
    policyRefs.add('R7');
    reasons.push(
      `Consumable is ${item.usagePercent}% used (over the ${POLICY.CONSUMABLE_MAX_USAGE}% limit) and is not eligible.`,
    );
  }

  if (eligible && reasons.length === 0) {
    reasons.push('Item is new/unused and eligible.');
  }

  return {
    sku: item.sku,
    name: item.name,
    eligible,
    requiresPhoto,
    restockingFeeRate,
    reasons,
    policyRefs: [...policyRefs],
  };
}

// ───────────────────────── R9 / R10: order & customer level ─────────────────────────

export interface CustomerStandingResult {
  refundsLast12mo: number;
  threshold: number;
  overThreshold: boolean;
  flags: string[];
  requiresManager: boolean;
  note: string;
  policyRefs: string[];
}

export function checkCustomerStanding(customer: Customer): CustomerStandingResult {
  const overThreshold = customer.refundsLast12mo > POLICY.REFUND_ABUSE_THRESHOLD;
  return {
    refundsLast12mo: customer.refundsLast12mo,
    threshold: POLICY.REFUND_ABUSE_THRESHOLD,
    overThreshold,
    flags: customer.flags ?? [],
    requiresManager: overThreshold,
    note: overThreshold
      ? `Customer has ${customer.refundsLast12mo} refunds in the last 12 months (over ${POLICY.REFUND_ABUSE_THRESHOLD}) — must be escalated for manual review.`
      : `Customer has ${customer.refundsLast12mo} refunds in the last 12 months — within normal limits.`,
    policyRefs: ['R10'],
  };
}

export interface HighValueResult {
  total: number;
  threshold: number;
  requiresManager: boolean;
  note: string;
  policyRefs: string[];
}

export function checkHighValue(order: Order): HighValueResult {
  const requiresManager = order.total > POLICY.HIGH_VALUE_THRESHOLD;
  return {
    total: order.total,
    threshold: POLICY.HIGH_VALUE_THRESHOLD,
    requiresManager,
    note: requiresManager
      ? `Order total $${order.total} exceeds $${POLICY.HIGH_VALUE_THRESHOLD} — requires manager approval.`
      : `Order total $${order.total} is under the $${POLICY.HIGH_VALUE_THRESHOLD} manager-approval threshold.`,
    policyRefs: ['R9'],
  };
}
