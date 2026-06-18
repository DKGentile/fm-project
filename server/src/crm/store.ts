/**
 * CRM repository.
 *
 * One async interface (CrmRepository) with two backends, selected by config:
 *   - JsonCrmRepository  (default) — in-memory, date-anchored, zero-infra.
 *   - PostgresCrmRepository        — LIVE per-call queries against Postgres.
 *
 * Tools `await` these methods, so in Postgres mode every tool call (lookup,
 * ownership check, refund) hits the live database — and refund writes are awaited
 * and transactional, so a persistence failure surfaces as a real error.
 */

import type { Customer, Order } from '@demitri/shared';
import { config } from '../config.js';
import { loadAnchoredCrm, loadRawCrm } from './anchor.js';
import { loadCustomers, persistRefundToPostgres, replacePostgresCrm } from './postgres.js';

export interface OrderHit {
  customer: Customer;
  order: Order;
}

export interface CrmRepository {
  /** Verify connectivity / warm caches at boot. */
  init(): Promise<void>;
  all(): Promise<Customer[]>;
  getById(id: string): Promise<Customer | undefined>;
  /** Exact email match — used for login. */
  findByEmail(email: string): Promise<Customer | undefined>;
  /** An order, but only if it belongs to the given customer (account scoping). */
  findOwnedOrder(customerId: string, orderId: string): Promise<Order | undefined>;
  findOrder(orderId: string): Promise<OrderHit | undefined>;
  /** Fuzzy lookup by id, email, phone, order id, or (partial) name. */
  findCustomer(query: string): Promise<Customer | undefined>;
  /** Record a processed refund (mark order refunded + bump the abuse counter). */
  applyRefund(orderId: string, amount: number, confirmation: string, sku?: string): Promise<void>;
  /** Restore the demo data set. */
  reset(): Promise<void>;
}

function findCustomerIn(customers: Customer[], query: string): Customer | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const exact = customers.find(
    (c) =>
      c.id.toLowerCase() === q ||
      c.email.toLowerCase() === q ||
      c.phone.replace(/[^\d]/g, '') === q.replace(/[^\d]/g, ''),
  );
  if (exact) return exact;
  const byOrder = customers.find((c) => c.orders.some((o) => o.id.toLowerCase() === q));
  if (byOrder) return byOrder;
  return customers.find(
    (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
  );
}

// ───────────────────────── JSON (in-memory, default) ─────────────────────────

class JsonCrmRepository implements CrmRepository {
  private customers: Customer[] = loadAnchoredCrm();

  async init(): Promise<void> {
    console.log(`  ▸ CRM backend: json (${this.customers.length} customers loaded)`);
  }

  async all(): Promise<Customer[]> {
    return this.customers;
  }

  async getById(id: string): Promise<Customer | undefined> {
    return this.customers.find((c) => c.id === id);
  }

  async findByEmail(email: string): Promise<Customer | undefined> {
    const e = email.trim().toLowerCase();
    return this.customers.find((c) => c.email.toLowerCase() === e);
  }

  async findOwnedOrder(customerId: string, orderId: string): Promise<Order | undefined> {
    const customer = this.customers.find((c) => c.id === customerId);
    if (!customer) return undefined;
    const q = orderId.trim().toLowerCase();
    return customer.orders.find((o) => o.id.toLowerCase() === q);
  }

  async findOrder(orderId: string): Promise<OrderHit | undefined> {
    const q = orderId.trim().toLowerCase();
    for (const customer of this.customers) {
      const order = customer.orders.find((o) => o.id.toLowerCase() === q);
      if (order) return { customer, order };
    }
    return undefined;
  }

  async findCustomer(query: string): Promise<Customer | undefined> {
    return findCustomerIn(this.customers, query);
  }

  async applyRefund(orderId: string, amount: number, confirmation: string): Promise<void> {
    const hit = await this.findOrder(orderId);
    if (!hit) return;
    hit.order.status = 'refunded';
    hit.order.refundedAmount = amount;
    hit.order.refundConfirmation = confirmation;
    hit.customer.refundsLast12mo += 1;
  }

  async reset(): Promise<void> {
    this.customers = loadAnchoredCrm();
  }
}

// ───────────────────────── Postgres (live per-call) ─────────────────────────

class PostgresCrmRepository implements CrmRepository {
  async init(): Promise<void> {
    const customers = await loadCustomers();
    console.log(`  ▸ CRM backend: postgres (${customers.length} customers; live per-request reads)`);
    if (customers.length === 0) {
      console.warn('  ⚠ Postgres returned 0 customers — run: npm -w server run seed:postgres');
    }
  }

  async all(): Promise<Customer[]> {
    return loadCustomers();
  }

  async getById(id: string): Promise<Customer | undefined> {
    return (await loadCustomers({ id }))[0];
  }

  async findByEmail(email: string): Promise<Customer | undefined> {
    return (await loadCustomers({ email: email.trim() }))[0];
  }

  async findOwnedOrder(customerId: string, orderId: string): Promise<Order | undefined> {
    const customer = await this.getById(customerId);
    if (!customer) return undefined;
    const q = orderId.trim().toLowerCase();
    return customer.orders.find((o) => o.id.toLowerCase() === q);
  }

  async findOrder(orderId: string): Promise<OrderHit | undefined> {
    const customers = await loadCustomers({ orderId });
    const q = orderId.trim().toLowerCase();
    for (const customer of customers) {
      const order = customer.orders.find((o) => o.id.toLowerCase() === q);
      if (order) return { customer, order };
    }
    return undefined;
  }

  async findCustomer(query: string): Promise<Customer | undefined> {
    return findCustomerIn(await loadCustomers(), query);
  }

  async applyRefund(orderId: string, amount: number, confirmation: string, sku?: string): Promise<void> {
    await persistRefundToPostgres({ orderId, amount, confirmation, sku });
  }

  async reset(): Promise<void> {
    await replacePostgresCrm(loadRawCrm());
  }
}

function createRepository(): CrmRepository {
  return config.crmBackend === 'postgres' ? new PostgresCrmRepository() : new JsonCrmRepository();
}

export const store: CrmRepository = createRepository();
