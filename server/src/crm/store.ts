/**
 * CRM store.
 *
 * By default it loads data/crm.json, "anchors" every date to the current day so
 * the scenarios stay valid whenever you run the demo, and exposes synchronous
 * lookups used by the agent tools. In CRM_BACKEND=postgres mode, startup loads
 * the same domain model from Postgres and refund mutations write through to DB.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Customer, Order } from '@northwind/shared';
import { config } from '../config.js';
import { DAY_MS, shiftIsoDate, toUtcMidnight } from '../utils/dates.js';
import {
  loadCustomersFromPostgres,
  persistRefundToPostgres,
  replacePostgresCrm,
} from './postgres.js';

interface RawCrm {
  _anchorDate: string;
  customers: Customer[];
}

const CRM_PATH = fileURLToPath(new URL('../../../data/crm.json', import.meta.url));

export function loadAnchoredCrm(): Customer[] {
  const raw = JSON.parse(readFileSync(CRM_PATH, 'utf8')) as RawCrm;
  const anchor = new Date(raw._anchorDate + 'T00:00:00Z').getTime();
  // Whole-day offset from today's UTC midnight so it matches daysSince()'s basis.
  const offsetDays = Math.round((toUtcMidnight(new Date()) - anchor) / DAY_MS);

  return raw.customers.map((c) => ({
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

export interface OrderHit {
  customer: Customer;
  order: Order;
}

class CrmStore {
  private customers: Customer[] = loadAnchoredCrm();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    if (config.crmBackend === 'postgres') {
      this.customers = await loadCustomersFromPostgres();
      console.log(`  ▸ CRM backend: postgres (${this.customers.length} customers loaded)`);
    } else {
      console.log(`  ▸ CRM backend: json (${this.customers.length} customers loaded)`);
    }
    this.initialized = true;
  }

  reset(): void {
    this.customers = loadAnchoredCrm();
    if (config.crmBackend === 'postgres') {
      replacePostgresCrm(this.customers).catch((err) => {
        console.error('Failed to reset Postgres CRM:', err);
      });
    }
  }

  all(): Customer[] {
    return this.customers;
  }

  getById(id: string): Customer | undefined {
    return this.customers.find((c) => c.id === id);
  }

  /** Exact email match — used for login. */
  findByEmail(email: string): Customer | undefined {
    const e = email.trim().toLowerCase();
    return this.customers.find((c) => c.email.toLowerCase() === e);
  }

  /** An order, but only if it belongs to the given customer (account scoping). */
  findOwnedOrder(customerId: string, orderId: string): Order | undefined {
    const customer = this.getById(customerId);
    if (!customer) return undefined;
    const q = orderId.trim().toLowerCase();
    return customer.orders.find((o) => o.id.toLowerCase() === q);
  }

  /** Fuzzy lookup by id, email, phone, order id, or (partial) name. */
  findCustomer(query: string): Customer | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    const exact = this.customers.find(
      (c) =>
        c.id.toLowerCase() === q ||
        c.email.toLowerCase() === q ||
        c.phone.replace(/[^\d]/g, '') === q.replace(/[^\d]/g, ''),
    );
    if (exact) return exact;
    const byOrder = this.customers.find((c) => c.orders.some((o) => o.id.toLowerCase() === q));
    if (byOrder) return byOrder;
    return this.customers.find(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
    );
  }

  findOrder(orderId: string): OrderHit | undefined {
    const q = orderId.trim().toLowerCase();
    for (const customer of this.customers) {
      const order = customer.orders.find((o) => o.id.toLowerCase() === q);
      if (order) return { customer, order };
    }
    return undefined;
  }

  /** Apply a successful refund: mark the order refunded and bump the abuse counter. */
  applyRefund(orderId: string, amount: number, confirmation: string): void {
    const hit = this.findOrder(orderId);
    if (!hit) return;
    hit.order.status = 'refunded';
    hit.order.refundedAmount = amount;
    hit.order.refundConfirmation = confirmation;
    hit.customer.refundsLast12mo += 1;
    if (config.crmBackend === 'postgres') {
      persistRefundToPostgres({
        customerId: hit.customer.id,
        orderId,
        sku: hit.order.items[0]?.sku,
        amount,
        confirmation,
      }).catch((err) => {
        console.error(`Failed to persist refund for ${orderId} to Postgres:`, err);
      });
    }
  }
}

export const store = new CrmStore();
