/**
 * Date anchoring for the mock CRM.
 *
 * The demo dates in data/crm.json are relative to a fixed `_anchorDate`. Both the
 * JSON store and the Postgres adapter shift them onto *today* at read time, so a
 * scenario seeded as "delivered 10 days ago" stays 10 days ago whenever you run
 * the demo — regardless of which backend, and without re-seeding daily.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Customer } from '@northwind/shared';
import { DAY_MS, shiftIsoDate, toUtcMidnight } from '../utils/dates.js';

const CRM_PATH = fileURLToPath(new URL('../../../data/crm.json', import.meta.url));

interface RawCrm {
  _anchorDate: string;
  customers: Customer[];
}

function readRawCrm(): RawCrm {
  return JSON.parse(readFileSync(CRM_PATH, 'utf8')) as RawCrm;
}

/** The reference date every mock CRM date is relative to. */
export const CRM_ANCHOR_DATE = readRawCrm()._anchorDate;

/** Whole-day shift that maps the anchor date onto today's UTC midnight. */
export function anchorOffsetDays(now: Date = new Date()): number {
  const anchor = new Date(CRM_ANCHOR_DATE + 'T00:00:00Z').getTime();
  return Math.round((toUtcMidnight(now) - anchor) / DAY_MS);
}

/** Shift a customer's dates from anchor-relative to today-relative. */
export function anchorCustomers(customers: Customer[], offsetDays = anchorOffsetDays()): Customer[] {
  if (offsetDays === 0) return customers;
  return customers.map((c) => ({
    ...c,
    accountCreated: shiftIsoDate(c.accountCreated, offsetDays),
    orders: c.orders.map((o) => ({
      ...o,
      date: shiftIsoDate(o.date, offsetDays),
      deliveredDate: o.deliveredDate ? shiftIsoDate(o.deliveredDate, offsetDays) : undefined,
      items: o.items.map((i) => ({ ...i })),
    })),
  }));
}

/** Raw crm.json customers (anchor-relative dates, NOT shifted) — used for seeding. */
export function loadRawCrm(): Customer[] {
  return readRawCrm().customers;
}

/** crm.json customers shifted to today — the in-memory dataset for JSON mode. */
export function loadAnchoredCrm(): Customer[] {
  return anchorCustomers(loadRawCrm());
}
