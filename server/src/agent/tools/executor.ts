/**
 * Tool execution. Dispatches a tool call to its handler and returns a ToolResult.
 *
 * SECURITY: every handler is scoped to the authenticated customer (ctx.customerId).
 * Order lookups go through resolveOwned(), which only finds orders on THAT
 * customer's account — so the agent (even under prompt injection) can never read
 * or act on another customer's order just because an order number was named.
 *
 * process_refund additionally re-validates the ENTIRE policy server-side (via
 * assessBlockers) and computes the amount itself, so enforcement never depends on
 * the prompt or a model-supplied figure.
 */

import type { Customer, Emit, Order, OrderItem } from '@northwind/shared';
import { store } from '../../crm/store.js';
import { chargeRefund, TransientGatewayError } from '../../payments/gateway.js';
import {
  checkCustomerStanding,
  checkHighValue,
  checkItemEligibility,
  checkReturnWindow,
} from '../../policy/rules.js';
import { calculateRefund } from '../../policy/refund.js';
import { nextEscalationTicket } from '../../utils/ids.js';
import { assessBlockers, recommendedActionFor } from './refundAssessment.js';
import type { ToolResult } from './types.js';

const REFUND_GATEWAY_MAX_ATTEMPTS = 3;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ToolContext {
  emit: Emit;
  /** The authenticated customer — all account/order access is scoped to this. */
  customerId: string;
}

type Input = Record<string, unknown>;

function notFound(message: string): ToolResult {
  return { output: { error: message }, isError: true };
}

function resolveItem(order: Order, sku?: string): OrderItem | undefined {
  if (sku) return order.items.find((i) => i.sku.toLowerCase() === sku.toLowerCase());
  if (order.items.length === 1) return order.items[0];
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** Resolve an order ONLY if it belongs to the authenticated customer. */
function resolveOwned(
  customerId: string,
  orderId: string,
): { customer: Customer; order: Order } | undefined {
  const customer = store.getById(customerId);
  if (!customer) return undefined;
  const q = orderId.trim().toLowerCase();
  const order = customer.orders.find((o) => o.id.toLowerCase() === q);
  return order ? { customer, order } : undefined;
}

const NOT_ON_ACCOUNT = (orderId: string) =>
  notFound(`I couldn't find order "${orderId}" on your account.`);

// ───────────────────────── handlers ─────────────────────────

function getMyAccount(customerId: string): ToolResult {
  const customer = store.getById(customerId);
  if (!customer) return notFound('Your account could not be loaded.');
  return {
    output: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      loyaltyTier: customer.loyaltyTier,
      refundsLast12mo: customer.refundsLast12mo,
      flags: customer.flags ?? [],
      orders: customer.orders.map((o) => ({
        id: o.id,
        date: o.date,
        deliveredDate: o.deliveredDate ?? null,
        status: o.status,
        total: o.total,
        paymentMethod: o.paymentMethod,
        items: o.items.map((i) => ({
          sku: i.sku,
          name: i.name,
          category: i.category,
          price: i.price,
          quantity: i.quantity,
          condition: i.condition ?? 'new',
        })),
      })),
    },
    isError: false,
  };
}

function getOrderDetails(input: Input, customerId: string): ToolResult {
  const orderId = String(input.orderId ?? '');
  const hit = resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  return { output: { order: hit.order }, isError: false };
}

function checkReturnWindowTool(input: Input, customerId: string): ToolResult {
  const orderId = String(input.orderId ?? '');
  const hit = resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  return { output: checkReturnWindow(hit.order), isError: false };
}

function checkItemEligibilityTool(input: Input, customerId: string): ToolResult {
  const orderId = String(input.orderId ?? '');
  const hit = resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const item = resolveItem(hit.order, input.sku ? String(input.sku) : undefined);
  if (!item) {
    return notFound(
      `Specify which item: order ${hit.order.id} has items [${hit.order.items.map((i) => i.sku).join(', ')}].`,
    );
  }
  return { output: checkItemEligibility(item, hit.order), isError: false };
}

function checkCustomerStandingTool(customerId: string): ToolResult {
  const customer = store.getById(customerId);
  if (!customer) return notFound('Your account could not be loaded.');
  return { output: checkCustomerStanding(customer), isError: false };
}

function calculateRefundAmount(input: Input, customerId: string): ToolResult {
  const orderId = String(input.orderId ?? '');
  const hit = resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const item = resolveItem(hit.order, input.sku ? String(input.sku) : undefined);
  if (!item) return notFound(`Specify which item to calculate for in order ${hit.order.id}.`);
  return {
    output: { ...calculateRefund(item), highValue: checkHighValue(hit.order) },
    isError: false,
  };
}

async function processRefund(input: Input, customerId: string, emit: Emit): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const item = resolveItem(hit.order, input.sku ? String(input.sku) : undefined);
  if (!item) return notFound(`Specify which item to refund in order ${hit.order.id}.`);

  // Server-side policy guardrail — refuse ineligible refunds outright.
  const blockers = assessBlockers(hit.customer, hit.order, item);
  if (blockers.length > 0) {
    return {
      output: {
        refused: true,
        reason: 'Refund blocked by policy. Do NOT retry process_refund for this item.',
        blockers,
        policyRefs: [...new Set(blockers.flatMap((b) => b.policyRefs))],
        recommendedAction: recommendedActionFor(blockers),
      },
      isError: true,
    };
  }

  // Eligible: compute the amount from policy, then charge (with retries).
  const calc = calculateRefund(item);
  for (let attempt = 1; ; attempt++) {
    try {
      const receipt = await chargeRefund(hit.order.id, calc.refundAmount, hit.order.paymentMethod);
      store.applyRefund(hit.order.id, calc.refundAmount, receipt.confirmation);
      return {
        output: {
          success: true,
          orderId: hit.order.id,
          sku: item.sku,
          refundAmount: calc.refundAmount,
          restockingFee: calc.restockingFee,
          method: hit.order.paymentMethod,
          confirmation: receipt.confirmation,
          attempts: attempt,
          reason: String(input.reason ?? ''),
        },
        isError: false,
        decision: {
          outcome: 'approved',
          detail: `Refunded $${calc.refundAmount} for ${item.name} to ${hit.order.paymentMethod}${
            attempt > 1 ? ` (succeeded after ${attempt} gateway attempts)` : ''
          }.`,
          orderId: hit.order.id,
          amount: calc.refundAmount,
          policyRefs: calc.policyRefs,
        },
      };
    } catch (err) {
      if (err instanceof TransientGatewayError && attempt < REFUND_GATEWAY_MAX_ATTEMPTS) {
        const nextDelayMs = 400 * attempt;
        emit({
          type: 'tool_retry',
          tool: 'process_refund',
          attempt,
          maxAttempts: REFUND_GATEWAY_MAX_ATTEMPTS,
          error: err.message,
          nextDelayMs,
        });
        await delay(nextDelayMs);
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: {
          success: false,
          error: `Refund could not be processed after ${attempt} attempt(s): ${message}`,
        },
        isError: true,
      };
    }
  }
}

function denyRefund(input: Input, customerId: string): ToolResult {
  const orderId = String(input.orderId ?? '');
  const hit = resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const reason = String(input.reason ?? 'Not eligible under policy.');
  const policyRefs = stringArray(input.policyRefs);
  return {
    output: { recorded: true, outcome: 'denied', orderId: hit.order.id, reason, policyRefs },
    isError: false,
    decision: { outcome: 'denied', detail: reason, orderId: hit.order.id, policyRefs },
  };
}

function escalateToHuman(input: Input, customerId: string): ToolResult {
  const orderId = String(input.orderId ?? '');
  const hit = resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const reason = String(input.reason ?? 'Requires manager review.');
  const policyRefs = stringArray(input.policyRefs);
  const ticket = nextEscalationTicket();
  return {
    output: { escalated: true, ticket, orderId: hit.order.id, reason, policyRefs, queue: 'refund-managers' },
    isError: false,
    decision: { outcome: 'escalated', detail: `${reason} (ticket ${ticket})`, orderId: hit.order.id, policyRefs },
  };
}

function requestPhotoEvidence(input: Input, customerId: string): ToolResult {
  const orderId = String(input.orderId ?? '');
  const hit = resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  return {
    output: {
      requested: true,
      orderId: hit.order.id,
      instructions:
        'Customer should reply with clear photos of the defect and the shipping label. Refund is on hold (R8) until received.',
    },
    isError: false,
    decision: {
      outcome: 'info_requested',
      detail: 'Requested photo evidence for a defective-item claim.',
      orderId: hit.order.id,
      policyRefs: ['R8'],
    },
  };
}

// ───────────────────────── dispatch ─────────────────────────

export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const input = (rawInput ?? {}) as Input;
  const { customerId, emit } = ctx;

  switch (name) {
    case 'get_my_account':
      return getMyAccount(customerId);
    case 'get_order_details':
      return getOrderDetails(input, customerId);
    case 'check_return_window':
      return checkReturnWindowTool(input, customerId);
    case 'check_item_eligibility':
      return checkItemEligibilityTool(input, customerId);
    case 'check_customer_standing':
      return checkCustomerStandingTool(customerId);
    case 'calculate_refund_amount':
      return calculateRefundAmount(input, customerId);
    case 'process_refund':
      return processRefund(input, customerId, emit);
    case 'deny_refund':
      return denyRefund(input, customerId);
    case 'escalate_to_human':
      return escalateToHuman(input, customerId);
    case 'request_photo_evidence':
      return requestPhotoEvidence(input, customerId);
    default:
      return notFound(`Unknown tool "${name}".`);
  }
}
