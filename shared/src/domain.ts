/**
 * CRM domain model — customers, orders, and line items.
 * Shared verbatim between the server (source of truth) and the web client.
 */

export type LoyaltyTier = 'standard' | 'silver' | 'gold' | 'platinum';

export type ItemCategory =
  | 'electronics'
  | 'apparel'
  | 'intimate_apparel'
  | 'gift_card'
  | 'digital'
  | 'perishable'
  | 'clearance'
  | 'home'
  | 'beauty'
  | 'consumable'
  | 'accessory';

export type ItemCondition =
  | 'new'
  | 'opened'
  | 'used'
  | 'damaged_by_customer'
  | 'defective';

export type OrderStatus =
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'refunded'
  | 'cancelled';

export interface OrderItem {
  sku: string;
  name: string;
  category: ItemCategory;
  price: number;
  quantity: number;
  condition?: ItemCondition;
  /** Explicitly marked final sale at purchase. */
  finalSale?: boolean;
  /** For consumables: percent of the product used (0–100). */
  usagePercent?: number;
  /** For digital goods: has the license been accessed/activated? */
  digitalAccessed?: boolean;
}

export interface Order {
  id: string;
  /** ISO date the order was placed. */
  date: string;
  /** ISO date the order was delivered (absent if not yet delivered). */
  deliveredDate?: string;
  status: OrderStatus;
  total: number;
  paymentMethod: string;
  items: OrderItem[];
  /** For defective-claim proof (R8). */
  photoEvidenceProvided?: boolean;
  /** Set once a refund has been issued. */
  refundedAmount?: number;
  /** Confirmation id from the (simulated) payment gateway. */
  refundConfirmation?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  loyaltyTier: LoyaltyTier;
  accountCreated: string;
  refundsLast12mo: number;
  lifetimeValue: number;
  flags?: string[];
  scenario?: string;
  orders: Order[];
}
