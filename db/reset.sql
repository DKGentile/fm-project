-- Drop the [Private Client] demo CRM schema so db/schema.sql can recreate it cleanly.
--
-- This is intended for synthetic/demo data only. Do not use this pattern for
-- production migrations.

DROP TABLE IF EXISTS refunds CASCADE;
DROP TABLE IF EXISTS refund_claims CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

DROP FUNCTION IF EXISTS touch_updated_at() CASCADE;

DROP TYPE IF EXISTS refund_status CASCADE;
DROP TYPE IF EXISTS claim_status CASCADE;
DROP TYPE IF EXISTS item_condition CASCADE;
DROP TYPE IF EXISTS item_category CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;
DROP TYPE IF EXISTS loyalty_tier CASCADE;

