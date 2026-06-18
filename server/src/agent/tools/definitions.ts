/**
 * Tool schemas advertised to the model. The read-only check_* tools validate
 * policy; process_refund / deny_refund / escalate_to_human / request_photo_evidence
 * are the terminal actions. Execution lives in ./executor.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_my_account',
    description:
      "Look up the signed-in customer's profile (loyalty tier, refund history, flags) and ALL of their orders. The customer is already authenticated, so no search query is needed. Use this first to see what they have ordered.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_order_details',
    description:
      'Get the full details of a single order: status, order/delivery dates, total, payment method, and every line item with its category and condition.',
    input_schema: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'The order ID, e.g. O1004.' } },
      required: ['orderId'],
    },
  },
  {
    name: 'check_return_window',
    description:
      'Validate an order against the 30-day return window (R1) and refundable-status rules (R2). Returns days since delivery and whether the order is in a refundable state.',
    input_schema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
  },
  {
    name: 'check_item_eligibility',
    description:
      'Validate a specific line item against the category/final-sale (R3), digital-goods (R4), condition (R5), restocking-fee (R6), consumable (R7), and photo-evidence (R8) rules. Returns eligibility, any restocking fee, and whether photo evidence is required.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        sku: {
          type: 'string',
          description: 'The line-item SKU. Optional if the order has a single item.',
        },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'check_customer_standing',
    description:
      'Check the signed-in customer against the refund-abuse threshold (R10): more than 3 refunds in the trailing 12 months must be escalated, not auto-approved. Returns the refund count and any account flags. Takes no arguments — it always checks the authenticated customer.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'calculate_refund_amount',
    description:
      'Compute the exact refund amount for a line item, applying any restocking fee (R6). Also reports whether the order total triggers manager approval (R9).',
    input_schema: {
      type: 'object',
      properties: { orderId: { type: 'string' }, sku: { type: 'string' } },
      required: ['orderId'],
    },
  },
  {
    name: 'request_refund_confirmation',
    description:
      "Show the customer a confirmation prompt for an eligible refund (the exact item + amount) and ask them to confirm BEFORE any money moves. Call this once you've verified the item is eligible, then STOP and wait for the customer to confirm — do NOT call process_refund in the same turn. It re-validates policy and refuses if the item isn't actually eligible (so confirm only what's truly refundable).",
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        sku: { type: 'string', description: 'Optional if the order has a single item.' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'process_refund',
    description:
      'Issue a refund to the original payment method. Call this ONLY after the customer has explicitly confirmed via request_refund_confirmation. The amount is computed server-side from policy — you do not pass it. This tool re-validates ALL policy rules and will refuse if the item is not eligible, requires manager approval, or requires photo evidence.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        sku: { type: 'string', description: 'Optional if the order has a single item.' },
        reason: { type: 'string', description: 'Short reason for the refund, for the audit log.' },
      },
      required: ['orderId', 'reason'],
    },
  },
  {
    name: 'deny_refund',
    description:
      'Record that a refund was denied. Use when an item is ineligible under policy. Provide the rule numbers that justify the denial.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        reason: { type: 'string' },
        policyRefs: { type: 'array', items: { type: 'string' }, description: 'e.g. ["R1"], ["R3"]' },
      },
      required: ['orderId', 'reason'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Escalate to a human manager. Use for high-value orders over $500 (R9), customers over the refund-abuse threshold (R10), or any case requiring goodwill judgment beyond policy.',
    input_schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        reason: { type: 'string' },
        policyRefs: { type: 'array', items: { type: 'string' } },
      },
      required: ['orderId', 'reason'],
    },
  },
  {
    name: 'request_photo_evidence',
    description:
      'Ask the customer to provide photo evidence for a defective-item claim over $100 (R8) before a refund can be processed.',
    input_schema: {
      type: 'object',
      properties: { orderId: { type: 'string' }, sku: { type: 'string' } },
      required: ['orderId'],
    },
  },
];
