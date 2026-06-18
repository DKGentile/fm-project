/**
 * Policy-engine unit tests. These run against the real (date-anchored) CRM and
 * verify the deterministic refund rules — no API key or LLM required.
 *   run with:  npm test
 */

import '../testSetup.js'; // must be first — forces the hermetic JSON backend
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Order, OrderItem } from '@demitri/shared';
import { loadAnchoredCrm } from '../crm/anchor.js';
import {
  checkCustomerStanding,
  checkHighValue,
  checkItemEligibility,
  checkReturnWindow,
} from './rules.js';
import { calculateRefund } from './refund.js';

// Pure policy tests run synchronously against the anchored dataset (no async repo).
const CRM = loadAnchoredCrm();

function order(id: string) {
  for (const c of CRM) {
    const o = c.orders.find((x) => x.id === id);
    if (o) return o;
  }
  return assert.fail(`order ${id} should exist`);
}

function findCustomer(query: string) {
  const q = query.toLowerCase();
  return CRM.find(
    (c) =>
      c.id.toLowerCase() === q ||
      c.email.toLowerCase() === q ||
      c.orders.some((o) => o.id.toLowerCase() === q),
  );
}
function item(id: string) {
  const o = order(id);
  return { order: o, item: o.items[0] };
}

test('R1 — in-window delivered order is within the window (O1001)', () => {
  const r = checkReturnWindow(order('O1001'));
  assert.equal(r.refundableStatus, true);
  assert.equal(r.withinWindow, true);
});

test('R1 — order delivered 45 days ago is outside the window (O1002)', () => {
  const r = checkReturnWindow(order('O1002'));
  assert.equal(r.withinWindow, false);
  assert.ok((r.daysSinceDelivery ?? 0) > 30);
});

test('R2 — shipped (undelivered) order is not refundable (O1009)', () => {
  const r = checkReturnWindow(order('O1009'));
  assert.equal(r.refundableStatus, false);
  assert.deepEqual(r.policyRefs, ['R2']);
});

test('R2 — already-refunded order cannot be refunded again (O1010)', () => {
  const r = checkReturnWindow(order('O1010'));
  assert.equal(r.refundableStatus, false);
});

test('R3 — gift card is final sale, not eligible (O1003)', () => {
  const { order: o, item: i } = item('O1003');
  const e = checkItemEligibility(i, o);
  assert.equal(e.eligible, false);
  assert.ok(e.policyRefs.includes('R3'));
});

test('R3 — clearance item is final sale (O1012)', () => {
  const { order: o, item: i } = item('O1012');
  assert.equal(checkItemEligibility(i, o).eligible, false);
});

test('R3 — intimate apparel is final sale (O1013)', () => {
  const { order: o, item: i } = item('O1013');
  assert.equal(checkItemEligibility(i, o).eligible, false);
});

test('R4 — accessed digital license is not eligible (O1007)', () => {
  const { order: o, item: i } = item('O1007');
  const e = checkItemEligibility(i, o);
  assert.equal(e.eligible, false);
  assert.ok(e.policyRefs.includes('R4'));
});

test('R4 — unaccessed digital license is eligible (O1008)', () => {
  const { order: o, item: i } = item('O1008');
  assert.equal(checkItemEligibility(i, o).eligible, true);
});

test('R5 — customer-damaged item is not eligible (O1015)', () => {
  const { order: o, item: i } = item('O1015');
  const e = checkItemEligibility(i, o);
  assert.equal(e.eligible, false);
  assert.ok(e.policyRefs.includes('R5'));
});

test('R5/R8 — defective laptop > $100 needs photo evidence (O1004)', () => {
  const { order: o, item: i } = item('O1004');
  const e = checkItemEligibility(i, o);
  assert.equal(e.eligible, true);
  assert.equal(e.requiresPhoto, true);
  assert.ok(e.policyRefs.includes('R8'));
});

test('R5 — defective item under $100 is eligible with no photo/fee (O1014)', () => {
  const { order: o, item: i } = item('O1014');
  const e = checkItemEligibility(i, o);
  assert.equal(e.eligible, true);
  assert.equal(e.requiresPhoto, false);
  assert.equal(e.restockingFeeRate, 0);
});

test('R6 — opened electronics carry a 15% restocking fee (O1006)', () => {
  const { order: o, item: i } = item('O1006');
  const e = checkItemEligibility(i, o);
  assert.equal(e.eligible, true);
  assert.equal(e.restockingFeeRate, 0.15);
  const calc = calculateRefund(i);
  assert.equal(calc.restockingFee, 30);
  assert.equal(calc.refundAmount, 169.99);
});

test('R7 — consumable over 50% used is not eligible (O1011)', () => {
  const { order: o, item: i } = item('O1011');
  const e = checkItemEligibility(i, o);
  assert.equal(e.eligible, false);
  assert.ok(e.policyRefs.includes('R7'));
});

test('R9 — order over $500 requires manager approval (O1004)', () => {
  const r = checkHighValue(order('O1004'));
  assert.equal(r.requiresManager, true);
});

test('R9 — order under $500 does not require manager approval (O1001)', () => {
  assert.equal(checkHighValue(order('O1001')).requiresManager, false);
});

test('R10 — customer over the refund-abuse threshold must be escalated (Eve)', () => {
  const eve = findCustomer('eve.thompson@example.com');
  assert.ok(eve);
  const s = checkCustomerStanding(eve!);
  assert.equal(s.overThreshold, true);
  assert.equal(s.requiresManager, true);
});

test('R10 — customer within limits does not require escalation (Alice)', () => {
  const alice = findCustomer('alice.nguyen@example.com');
  assert.ok(alice);
  assert.equal(checkCustomerStanding(alice!).requiresManager, false);
});

test('store — fuzzy lookup finds customer by order id and email', () => {
  assert.equal(findCustomer('O1004')?.name, 'David Okafor');
  assert.equal(findCustomer('frank.li@example.com')?.id, 'C006');
});

// ── regression tests for issues surfaced by the adversarial review ──

function mkItem(p: Partial<OrderItem>): OrderItem {
  return { sku: 'SKU-X', name: 'Test Item', category: 'home', price: 50, quantity: 1, ...p };
}
function mkOrder(p: Partial<Order> = {}): Order {
  return {
    id: 'OX',
    date: '2026-06-01',
    deliveredDate: '2026-06-05',
    status: 'delivered',
    total: 50,
    paymentMethod: 'Visa ****0000',
    items: [],
    ...p,
  };
}

test("R5 — 'used' condition is not eligible (no silent full refund)", () => {
  const e = checkItemEligibility(mkItem({ condition: 'used' }), mkOrder());
  assert.equal(e.eligible, false);
  assert.ok(e.policyRefs.includes('R5'));
});

test('R5 — opened non-electronics is eligible with no restocking fee', () => {
  const e = checkItemEligibility(mkItem({ condition: 'opened', category: 'home' }), mkOrder());
  assert.equal(e.eligible, true);
  assert.equal(e.restockingFeeRate, 0);
});

test('R8 — defective threshold uses line value (2 × $60 = $120 needs photo)', () => {
  const e = checkItemEligibility(
    mkItem({ condition: 'defective', price: 60, quantity: 2 }),
    mkOrder({ photoEvidenceProvided: false }),
  );
  assert.equal(e.requiresPhoto, true);
});

test('R7 — usagePercent on a non-consumable does NOT trigger the consumable block', () => {
  const e = checkItemEligibility(
    mkItem({ category: 'electronics', condition: 'new', usagePercent: 80 }),
    mkOrder(),
  );
  assert.equal(e.eligible, true);
  assert.ok(!e.policyRefs.includes('R7'));
});
