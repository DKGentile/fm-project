-- [Private Client] Refund Agent - Postgres CRM schema
--
-- This schema stores the operational CRM data the refund tools need:
-- customers, orders, purchased line-item snapshots, vaulted payment methods,
-- and refund audit records. It intentionally does NOT store raw card numbers
-- or CVV values; payment_methods.vault_token represents a processor vault token.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loyalty_tier') THEN
    CREATE TYPE loyalty_tier AS ENUM ('standard', 'silver', 'gold', 'platinum');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('processing', 'shipped', 'delivered', 'refunded', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_category') THEN
    CREATE TYPE item_category AS ENUM (
      'electronics',
      'apparel',
      'intimate_apparel',
      'gift_card',
      'digital',
      'perishable',
      'clearance',
      'home',
      'beauty',
      'consumable',
      'accessory'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_condition') THEN
    CREATE TYPE item_condition AS ENUM ('new', 'opened', 'used', 'damaged_by_customer', 'defective');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'refund_status') THEN
    CREATE TYPE refund_status AS ENUM ('requested', 'approved', 'denied', 'escalated', 'processed', 'failed');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_status') THEN
    CREATE TYPE claim_status AS ENUM ('open', 'info_requested', 'approved', 'denied', 'escalated', 'closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  email citext UNIQUE,
  phone text NOT NULL,
  loyalty_tier loyalty_tier NOT NULL DEFAULT 'standard',
  account_created date NOT NULL,
  refunds_last_12mo integer NOT NULL DEFAULT 0 CHECK (refunds_last_12mo >= 0),
  lifetime_value_cents integer NOT NULL DEFAULT 0 CHECK (lifetime_value_cents >= 0),
  flags text[] NOT NULL DEFAULT '{}',
  scenario text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mock_gateway',
  vault_token text NOT NULL UNIQUE,
  brand text NOT NULL,
  last4 char(4) NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month integer NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year integer NOT NULL CHECK (exp_year BETWEEN 2024 AND 2100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  payment_method_id text NOT NULL REFERENCES payment_methods(id),
  order_date date NOT NULL,
  delivered_date date,
  status order_status NOT NULL,
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  refunded_amount_cents integer CHECK (refunded_amount_cents IS NULL OR refunded_amount_cents >= 0),
  refund_confirmation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivered_orders_have_delivery_date
    CHECK (status <> 'delivered' OR delivered_date IS NOT NULL),
  CONSTRAINT refunded_orders_have_refund_amount
    CHECK (status <> 'refunded' OR refunded_amount_cents IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS order_items (
  id bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku text NOT NULL,
  product_name text NOT NULL,
  category item_category NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  condition item_condition NOT NULL DEFAULT 'new',
  final_sale boolean NOT NULL DEFAULT false,
  usage_percent integer CHECK (usage_percent BETWEEN 0 AND 100),
  digital_accessed boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, sku)
);

CREATE TABLE IF NOT EXISTS refund_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL REFERENCES customers(id),
  order_id text NOT NULL REFERENCES orders(id),
  order_item_id bigint REFERENCES order_items(id),
  status claim_status NOT NULL DEFAULT 'open',
  claim_reason text,
  photo_evidence_required boolean NOT NULL DEFAULT false,
  photo_evidence_provided boolean NOT NULL DEFAULT false,
  policy_refs text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid REFERENCES refund_claims(id),
  customer_id text NOT NULL REFERENCES customers(id),
  order_id text NOT NULL REFERENCES orders(id),
  order_item_id bigint REFERENCES order_items(id),
  status refund_status NOT NULL,
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  restocking_fee_cents integer CHECK (restocking_fee_cents IS NULL OR restocking_fee_cents >= 0),
  reason text,
  policy_refs text[] NOT NULL DEFAULT '{}',
  gateway_provider text NOT NULL DEFAULT 'mock_gateway',
  gateway_attempts integer NOT NULL DEFAULT 0 CHECK (gateway_attempts >= 0),
  confirmation text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku);
CREATE INDEX IF NOT EXISTS idx_refund_claims_customer_id ON refund_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_refund_claims_order_id ON refund_claims(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_customer_id ON refunds(customer_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_customer_id ON payment_methods(customer_id);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_customers_updated_at ON customers;
CREATE TRIGGER touch_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS touch_payment_methods_updated_at ON payment_methods;
CREATE TRIGGER touch_payment_methods_updated_at
BEFORE UPDATE ON payment_methods
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS touch_orders_updated_at ON orders;
CREATE TRIGGER touch_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS touch_order_items_updated_at ON order_items;
CREATE TRIGGER touch_order_items_updated_at
BEFORE UPDATE ON order_items
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS touch_refund_claims_updated_at ON refund_claims;
CREATE TRIGGER touch_refund_claims_updated_at
BEFORE UPDATE ON refund_claims
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS touch_refunds_updated_at ON refunds;
CREATE TRIGGER touch_refunds_updated_at
BEFORE UPDATE ON refunds
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON COLUMN customers.lifetime_value_cents IS
  'Integer minor units avoid floating-point rounding bugs in money math.';
COMMENT ON COLUMN orders.total_cents IS
  'Integer minor units avoid floating-point rounding bugs in money math.';
COMMENT ON COLUMN order_items.unit_price_cents IS
  'Snapshot of the purchased unit price in integer minor units.';
COMMENT ON TABLE refund_claims IS
  'Customer refund/return request state, separate from the original order transaction.';
COMMENT ON COLUMN refund_claims.photo_evidence_provided IS
  'R8 evidence flag. A production version would point to uploaded evidence objects.';
COMMENT ON COLUMN payment_methods.vault_token IS
  'Mock payment-processor vault token. Raw card numbers/CVV are never stored.';
COMMENT ON COLUMN payment_methods.exp_month IS
  'Seeded payment-method expiration metadata. Real refunds usually rely on processor vault tokens, not raw card validity checks.';
COMMENT ON COLUMN payment_methods.exp_year IS
  'Seeded payment-method expiration metadata. Real refunds usually rely on processor vault tokens, not raw card validity checks.';
