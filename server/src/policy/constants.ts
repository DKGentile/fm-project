/**
 * Refund-policy thresholds and category rules (mirrors data/refund-policy.md).
 * Centralised so no magic numbers leak into the rule logic.
 */

import type { ItemCategory } from '@demitri/shared';

export const POLICY = {
  RETURN_WINDOW_DAYS: 30, // R1
  HIGH_VALUE_THRESHOLD: 500, // R9
  REFUND_ABUSE_THRESHOLD: 3, // R10 (more than 3)
  PHOTO_REQUIRED_OVER: 100, // R8
  RESTOCKING_FEE_RATE: 0.15, // R6
  CONSUMABLE_MAX_USAGE: 50, // R7 (more than 50% used)
} as const;

/** Categories that are always final sale (R3). */
export const FINAL_SALE_CATEGORIES: ReadonlySet<ItemCategory> = new Set<ItemCategory>([
  'gift_card',
  'clearance',
  'perishable',
  'intimate_apparel',
]);
