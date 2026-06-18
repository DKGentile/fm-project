/**
 * Postgres CRM adapter.
 *
 * The agent tools operate on the shared Customer/Order domain model. This file
 * runs LIVE, scoped queries against Postgres on each call (a customer + their
 * orders), re-anchors the demo dates onto today, and writes refund mutations
 * back transactionally.
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Customer, ItemCategory, ItemCondition, Order, OrderItem, OrderStatus } from '@northwind/shared';
import { config } from '../config.js';
import { POLICY } from '../policy/constants.js';
import { anchorCustomers } from './anchor.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Translate libpq's `sslmode` into a node-postgres `ssl` option. We honor the
 * connection string's stated intent rather than silently forcing one posture:
 *   - disable .................... no TLS
 *   - allow/prefer/require ....... encrypt, but don't verify the chain (libpq semantics)
 *   - verify-ca / verify-full .... encrypt AND verify (needs a trusted CA)
 * A PG_CA_BUNDLE (e.g. the AWS RDS root CA) upgrades any TLS connection to a
 * verified one — the production-correct path. PG_TLS_INSECURE is an explicit
 * escape hatch that disables verification for the throwaway demo.
 */
function sslConfig(sslmode: string | null, hostname: string): pg.PoolConfig['ssl'] {
  if (config.pgTlsInsecure) {
    console.warn('  ⚠ PG_TLS_INSECURE=true — Postgres TLS certificate verification is DISABLED (demo only).');
    return { rejectUnauthorized: false };
  }

  // Default unspecified RDS connections to `require` (encrypt) rather than plaintext.
  const mode = sslmode ?? (hostname.endsWith('.rds.amazonaws.com') ? 'require' : 'disable');
  if (mode === 'disable') return undefined;

  const wantsVerify = mode === 'verify-ca' || mode === 'verify-full';
  if (config.pgCaBundle) {
    // Verified TLS against an explicit CA — works for both `require` and `verify-*`.
    return { ca: readFileSync(config.pgCaBundle, 'utf8'), rejectUnauthorized: true };
  }
  // verify-* without a CA bundle relies on the system trust store; require/prefer
  // encrypt without verification (matches psql/libpq, so a normal RDS URL connects).
  return { rejectUnauthorized: wantsVerify };
}

function poolConfig(): pg.PoolConfig {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required when CRM_BACKEND=postgres.');
  }
  const url = new URL(config.databaseUrl);
  // `pg` doesn't parse libpq's sslmode/uselibpqcompat — read intent, then drop them.
  const sslmode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');
  url.searchParams.delete('uselibpqcompat');
  return { connectionString: url.toString(), ssl: sslConfig(sslmode, url.hostname) };
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool(poolConfig());
  }
  return pool;
}

// ───────────────────────── row → domain mapping ─────────────────────────

function dateToIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function centsToDollars(value: unknown): number {
  return Number(value ?? 0) / 100;
}

function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

function paymentLabel(row: { brand: string; last4: string }): string {
  return `${row.brand} ****${row.last4}`;
}

function parsePaymentMethod(label: string): { brand: string; last4: string } {
  const match = label.match(/^(.+?)\s+\*{4}(\d{4})$/);
  return {
    brand: match?.[1]?.trim() || 'Card',
    last4: match?.[2] || '0000',
  };
}

function expirationFor(last4: string): { expMonth: number; expYear: number } {
  const n = Number(last4) || 0;
  const expMonth = (n % 12) + 1;
  const expYear = new Date().getFullYear() + 3 + (n % 4);
  return { expMonth, expYear };
}

function paymentMethodId(customerId: string, paymentMethod: string): string {
  const { brand, last4 } = parsePaymentMethod(paymentMethod);
  return `PM-${customerId}-${brand.replace(/[^a-z0-9]/gi, '').toUpperCase()}-${last4}`;
}

type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  loyalty_tier: Customer['loyaltyTier'];
  account_created: Date | string;
  refunds_last_12mo: number;
  lifetime_value_cents: number;
  flags: string[];
  scenario: string | null;
};

type OrderRow = {
  id: string;
  customer_id: string;
  order_date: Date | string;
  delivered_date: Date | string | null;
  status: OrderStatus;
  total_cents: number;
  refunded_amount_cents: number | null;
  refund_confirmation: string | null;
  brand: string;
  last4: string;
};

type ItemRow = {
  id: number;
  order_id: string;
  sku: string;
  product_name: string;
  category: ItemCategory;
  unit_price_cents: number;
  quantity: number;
  condition: ItemCondition;
  final_sale: boolean;
  usage_percent: number | null;
  digital_accessed: boolean | null;
};

type ClaimRow = {
  id: string;
  order_id: string;
  photo_evidence_provided: boolean;
};

export interface CustomerFilter {
  id?: string;
  email?: string;
  orderId?: string;
}

/**
 * Load customers (and their orders/items/claims) LIVE from Postgres, scoped by an
 * optional filter (one customer for getById, by email for login, an order's owner,
 * or all). Dates are re-anchored onto today to match JSON-mode semantics.
 */
export async function loadCustomers(filter: CustomerFilter = {}): Promise<Customer[]> {
  const db = getPool();

  let where = '';
  const whereParams: unknown[] = [];
  if (filter.id) {
    whereParams.push(filter.id);
    where = `where id = $${whereParams.length}`;
  } else if (filter.email) {
    whereParams.push(filter.email);
    where = `where email = $${whereParams.length}::citext`;
  } else if (filter.orderId) {
    whereParams.push(filter.orderId);
    where = `where id = (select customer_id from orders where id = $${whereParams.length})`;
  }

  const customerResult = await db.query<CustomerRow>(
    `select * from customers ${where} order by id`,
    whereParams,
  );
  const customerIds = customerResult.rows.map((r) => r.id);
  if (customerIds.length === 0) return [];

  const orderResult = await db.query<OrderRow>(
    `select o.*, pm.brand, pm.last4
       from orders o
       join payment_methods pm on pm.id = o.payment_method_id
      where o.customer_id = any($1)
      order by o.customer_id, o.order_date, o.id`,
    [customerIds],
  );
  const orderIds = orderResult.rows.map((r) => r.id);

  const [itemResult, claimResult] = await Promise.all([
    orderIds.length
      ? db.query<ItemRow>('select * from order_items where order_id = any($1) order by order_id, id', [orderIds])
      : Promise.resolve({ rows: [] as ItemRow[] }),
    orderIds.length
      ? db.query<ClaimRow>(
          'select id, order_id, photo_evidence_provided from refund_claims where order_id = any($1) order by created_at, id',
          [orderIds],
        )
      : Promise.resolve({ rows: [] as ClaimRow[] }),
  ]);

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const row of itemResult.rows) {
    const item: OrderItem = {
      sku: row.sku,
      name: row.product_name,
      category: row.category,
      price: centsToDollars(row.unit_price_cents),
      quantity: row.quantity,
      condition: row.condition,
      finalSale: row.final_sale || undefined,
      usagePercent: row.usage_percent ?? undefined,
      digitalAccessed: row.digital_accessed ?? undefined,
    };
    itemsByOrder.set(row.order_id, [...(itemsByOrder.get(row.order_id) ?? []), item]);
  }

  const photoEvidenceByOrder = new Map<string, boolean>();
  for (const row of claimResult.rows) {
    if (row.photo_evidence_provided) photoEvidenceByOrder.set(row.order_id, true);
    else if (!photoEvidenceByOrder.has(row.order_id)) photoEvidenceByOrder.set(row.order_id, false);
  }

  const ordersByCustomer = new Map<string, Order[]>();
  for (const row of orderResult.rows) {
    const order: Order = {
      id: row.id,
      date: dateToIso(row.order_date) ?? '',
      deliveredDate: dateToIso(row.delivered_date),
      status: row.status,
      total: centsToDollars(row.total_cents),
      paymentMethod: paymentLabel(row),
      items: itemsByOrder.get(row.id) ?? [],
      photoEvidenceProvided: photoEvidenceByOrder.get(row.id) || undefined,
      refundedAmount:
        row.refunded_amount_cents == null ? undefined : centsToDollars(row.refunded_amount_cents),
      refundConfirmation: row.refund_confirmation ?? undefined,
    };
    ordersByCustomer.set(row.customer_id, [...(ordersByCustomer.get(row.customer_id) ?? []), order]);
  }

  const customers = customerResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    loyaltyTier: row.loyalty_tier,
    accountCreated: dateToIso(row.account_created) ?? '',
    refundsLast12mo: row.refunds_last_12mo,
    lifetimeValue: centsToDollars(row.lifetime_value_cents),
    flags: row.flags ?? [],
    scenario: row.scenario ?? undefined,
    orders: ordersByCustomer.get(row.id) ?? [],
  }));

  // Re-anchor onto today so the time-sensitive R1 scenarios stay valid.
  return anchorCustomers(customers);
}

// ───────────────────────── seed (truncate + reinsert) ─────────────────────────

export async function replacePostgresCrm(customers: Customer[]): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      'truncate table refunds, refund_claims, order_items, orders, payment_methods, customers restart identity cascade',
    );

    const orderItemIds = new Map<string, number>();

    for (const customer of customers) {
      await client.query(
        `insert into customers (
           id, name, email, phone, loyalty_tier, account_created,
           refunds_last_12mo, lifetime_value_cents, flags, scenario
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          customer.id,
          customer.name,
          customer.email,
          customer.phone,
          customer.loyaltyTier,
          customer.accountCreated,
          customer.refundsLast12mo,
          dollarsToCents(customer.lifetimeValue),
          customer.flags ?? [],
          customer.scenario ?? null,
        ],
      );

      const seenPaymentMethods = new Set<string>();
      for (const order of customer.orders) {
        const pmId = paymentMethodId(customer.id, order.paymentMethod);
        if (!seenPaymentMethods.has(pmId)) {
          const parsed = parsePaymentMethod(order.paymentMethod);
          const exp = expirationFor(parsed.last4);
          await client.query(
            `insert into payment_methods (
               id, customer_id, provider, vault_token, brand, last4, exp_month, exp_year
             ) values ($1,$2,'mock_gateway',$3,$4,$5,$6,$7)
             on conflict (id) do nothing`,
            [pmId, customer.id, `vault_mock_${pmId.toLowerCase()}`, parsed.brand, parsed.last4, exp.expMonth, exp.expYear],
          );
          seenPaymentMethods.add(pmId);
        }

        await client.query(
          `insert into orders (
             id, customer_id, payment_method_id, order_date, delivered_date,
             status, total_cents, refunded_amount_cents, refund_confirmation
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            order.id,
            customer.id,
            pmId,
            order.date,
            order.deliveredDate ?? null,
            order.status,
            dollarsToCents(order.total),
            order.refundedAmount == null ? null : dollarsToCents(order.refundedAmount),
            order.refundConfirmation ?? null,
          ],
        );

        for (const item of order.items) {
          const result = await client.query<{ id: number }>(
            `insert into order_items (
               order_id, sku, product_name, category, unit_price_cents,
               quantity, condition, final_sale, usage_percent, digital_accessed
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
            [
              order.id,
              item.sku,
              item.name,
              item.category,
              dollarsToCents(item.price),
              item.quantity,
              item.condition ?? 'new',
              Boolean(item.finalSale),
              item.usagePercent ?? null,
              item.digitalAccessed ?? null,
            ],
          );
          orderItemIds.set(`${order.id}:${item.sku}`, result.rows[0].id);
        }

        const firstItem = order.items[0];
        const firstItemId = firstItem ? orderItemIds.get(`${order.id}:${firstItem.sku}`) : null;
        if (firstItem?.condition === 'defective' || order.photoEvidenceProvided != null) {
          const photoRequired = firstItem
            ? firstItem.price * firstItem.quantity > POLICY.PHOTO_REQUIRED_OVER
            : false;
          await client.query(
            `insert into refund_claims (
               customer_id, order_id, order_item_id, status, claim_reason,
               photo_evidence_required, photo_evidence_provided, policy_refs
             ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              customer.id,
              order.id,
              firstItemId,
              photoRequired && !order.photoEvidenceProvided ? 'info_requested' : 'open',
              firstItem?.condition === 'defective' ? 'Seeded defective-item claim' : 'Seeded refund claim',
              photoRequired,
              Boolean(order.photoEvidenceProvided),
              photoRequired ? ['R8'] : [],
            ],
          );
        }

        if (order.status === 'refunded' && order.refundedAmount != null) {
          const claimResult = await client.query<{ id: string }>(
            `insert into refund_claims (
               customer_id, order_id, order_item_id, status, claim_reason,
               photo_evidence_required, photo_evidence_provided, policy_refs
             ) values ($1,$2,$3,'closed','Seeded historical refund claim',false,false,$4) returning id`,
            [customer.id, order.id, firstItemId, []],
          );
          await client.query(
            `insert into refunds (
               claim_id, customer_id, order_id, order_item_id, status, amount_cents,
               reason, policy_refs, confirmation, gateway_attempts
             ) values ($1,$2,$3,$4,'processed',$5,$6,$7,$8,1)`,
            [
              claimResult.rows[0].id,
              customer.id,
              order.id,
              firstItemId,
              dollarsToCents(order.refundedAmount),
              'Seeded historical refund',
              [],
              order.refundConfirmation ?? null,
            ],
          );
        }
      }
    }

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

// ───────────────────────── refund write-through ─────────────────────────

/**
 * Persist a processed refund. Idempotent and self-guarding: it only transitions
 * an order that isn't already refunded (so a replay can't double-count the abuse
 * counter or duplicate refund rows), and derives the customer from the order.
 */
export async function persistRefundToPostgres(args: {
  orderId: string;
  amount: number;
  confirmation: string;
  sku?: string;
}): Promise<void> {
  const db = getPool();
  const amountCents = dollarsToCents(args.amount);
  const client = await db.connect();
  try {
    await client.query('begin');

    const updated = await client.query<{ customer_id: string }>(
      `update orders
          set status = 'refunded', refunded_amount_cents = $1, refund_confirmation = $2
        where id = $3 and status <> 'refunded'
        returning customer_id`,
      [amountCents, args.confirmation, args.orderId],
    );

    // Already refunded (or unknown order): commit a no-op rather than double-write.
    if (updated.rowCount === 0) {
      await client.query('commit');
      return;
    }
    const customerId = updated.rows[0].customer_id;

    await client.query('update customers set refunds_last_12mo = refunds_last_12mo + 1 where id = $1', [
      customerId,
    ]);

    const claim = await client.query<{ id: string }>(
      `insert into refund_claims (
         customer_id, order_id, order_item_id, status, claim_reason,
         photo_evidence_required, photo_evidence_provided, policy_refs
       ) values (
         $1, $2,
         (select id from order_items where order_id = $2 and ($3::text is null or sku = $3) order by id limit 1),
         'closed', 'Processed by AI refund agent', false, false, '{}'
       ) returning id`,
      [customerId, args.orderId, args.sku ?? null],
    );

    await client.query(
      `insert into refunds (
         claim_id, customer_id, order_id, order_item_id, status, amount_cents,
         reason, confirmation, gateway_attempts
       ) values (
         $1, $2, $3,
         (select id from order_items where order_id = $3 and ($4::text is null or sku = $4) order by id limit 1),
         'processed', $5, 'Processed by AI refund agent', $6, 1
       )`,
      [claim.rows[0].id, customerId, args.orderId, args.sku ?? null, amountCents, args.confirmation],
    );

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Run raw SQL (e.g. apply db/schema.sql). Used by the dev seed task. */
export async function applySql(sql: string): Promise<void> {
  await getPool().query(sql);
}

export async function closePostgresPool(): Promise<void> {
  await pool?.end();
  pool = null;
}
