/**
 * Postgres CRM adapter.
 *
 * The agent tools operate on the shared Customer/Order domain model. This file
 * translates the relational CRM schema into that model and writes refund
 * mutations back to Postgres.
 */

import pg from 'pg';
import type { Customer, ItemCategory, ItemCondition, Order, OrderItem, OrderStatus } from '@northwind/shared';
import { config } from '../config.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function poolConfig(): pg.PoolConfig {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required when CRM_BACKEND=postgres.');
  }
  const url = new URL(config.databaseUrl);
  const wantsSsl =
    url.searchParams.has('sslmode') || url.hostname.endsWith('.rds.amazonaws.com');
  url.searchParams.delete('sslmode');
  url.searchParams.delete('uselibpqcompat');
  return {
    connectionString: url.toString(),
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
  };
}

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool(poolConfig());
  }
  return pool;
}

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
  photo_evidence_provided: boolean;
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

export async function loadCustomersFromPostgres(): Promise<Customer[]> {
  const db = getPool();
  const [customerResult, orderResult, itemResult] = await Promise.all([
    db.query<CustomerRow>('select * from customers order by id'),
    db.query<OrderRow>(`
      select
        o.*,
        pm.brand,
        pm.last4
      from orders o
      join payment_methods pm on pm.id = o.payment_method_id
      order by o.customer_id, o.order_date, o.id
    `),
    db.query<ItemRow>('select * from order_items order by order_id, id'),
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
      photoEvidenceProvided: row.photo_evidence_provided || undefined,
      refundedAmount:
        row.refunded_amount_cents == null ? undefined : centsToDollars(row.refunded_amount_cents),
      refundConfirmation: row.refund_confirmation ?? undefined,
    };
    ordersByCustomer.set(row.customer_id, [...(ordersByCustomer.get(row.customer_id) ?? []), order]);
  }

  return customerResult.rows.map((row) => ({
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
}

export async function replacePostgresCrm(customers: Customer[]): Promise<void> {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('truncate table refunds, order_items, orders, payment_methods, customers restart identity cascade');

    const orderItemIds = new Map<string, number>();

    for (const customer of customers) {
      await client.query(
        `
          insert into customers (
            id, name, email, phone, loyalty_tier, account_created,
            refunds_last_12mo, lifetime_value_cents, flags, scenario
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
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
          await client.query(
            `
              insert into payment_methods (
                id, customer_id, provider, vault_token, brand, last4
              )
              values ($1,$2,'mock_gateway',$3,$4,$5)
              on conflict (id) do nothing
            `,
            [pmId, customer.id, `vault_mock_${pmId.toLowerCase()}`, parsed.brand, parsed.last4],
          );
          seenPaymentMethods.add(pmId);
        }

        await client.query(
          `
            insert into orders (
              id, customer_id, payment_method_id, order_date, delivered_date,
              status, total_cents, photo_evidence_provided, refunded_amount_cents,
              refund_confirmation
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            order.id,
            customer.id,
            pmId,
            order.date,
            order.deliveredDate ?? null,
            order.status,
            dollarsToCents(order.total),
            Boolean(order.photoEvidenceProvided),
            order.refundedAmount == null ? null : dollarsToCents(order.refundedAmount),
            order.refundConfirmation ?? null,
          ],
        );

        for (const item of order.items) {
          const result = await client.query<{ id: number }>(
            `
              insert into order_items (
                order_id, sku, product_name, category, unit_price_cents,
                quantity, condition, final_sale, usage_percent, digital_accessed
              )
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              returning id
            `,
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

        if (order.status === 'refunded' && order.refundedAmount != null) {
          await client.query(
            `
              insert into refunds (
                customer_id, order_id, order_item_id, status, amount_cents,
                reason, policy_refs, confirmation, gateway_attempts
              )
              values ($1,$2,$3,'processed',$4,$5,$6,$7,1)
            `,
            [
              customer.id,
              order.id,
              order.items[0] ? orderItemIds.get(`${order.id}:${order.items[0].sku}`) : null,
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

export async function persistRefundToPostgres(args: {
  customerId: string;
  orderId: string;
  sku?: string;
  amount: number;
  confirmation: string;
}): Promise<void> {
  const db = getPool();
  const amountCents = dollarsToCents(args.amount);
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `
        update orders
        set status = 'refunded',
            refunded_amount_cents = $1,
            refund_confirmation = $2
        where id = $3 and customer_id = $4
      `,
      [amountCents, args.confirmation, args.orderId, args.customerId],
    );
    await client.query(
      `
        update customers
        set refunds_last_12mo = refunds_last_12mo + 1
        where id = $1
      `,
      [args.customerId],
    );
    await client.query(
      `
        insert into refunds (
          customer_id, order_id, order_item_id, status, amount_cents,
          reason, confirmation, gateway_attempts
        )
        values (
          $1,
          $2,
          (select id from order_items where order_id = $2 and ($3::text is null or sku = $3) order by id limit 1),
          'processed',
          $4,
          'Processed by AI refund agent',
          $5,
          1
        )
      `,
      [args.customerId, args.orderId, args.sku ?? null, amountCents, args.confirmation],
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePostgresPool(): Promise<void> {
  await pool?.end();
  pool = null;
}
