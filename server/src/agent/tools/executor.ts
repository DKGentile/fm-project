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
  /** Orders confirmed for refund across this session (persists between turns). */
  sessionConfirmations: Set<string>;
  /** Orders whose confirmation was first requested in THIS turn (blocks
   *  confirm-then-process within a single turn). */
  confirmRequestedThisTurn: Set<string>;
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
async function resolveOwned(
  customerId: string,
  orderId: string,
): Promise<{ customer: Customer; order: Order } | undefined> {
  const customer = await store.getById(customerId);
  if (!customer) return undefined;
  const q = orderId.trim().toLowerCase();
  const order = customer.orders.find((o) => o.id.toLowerCase() === q);
  return order ? { customer, order } : undefined;
}

const NOT_ON_ACCOUNT = (orderId: string) =>
  notFound(`I couldn't find order "${orderId}" on your account.`);

// ───────────────────────── handlers ─────────────────────────

async function getMyAccount(customerId: string): Promise<ToolResult> {
  const customer = await store.getById(customerId);
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

async function getOrderDetails(input: Input, customerId: string): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  return { output: { order: hit.order }, isError: false };
}

async function checkReturnWindowTool(input: Input, customerId: string): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  return { output: checkReturnWindow(hit.order), isError: false };
}

async function checkItemEligibilityTool(input: Input, customerId: string): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const item = resolveItem(hit.order, input.sku ? String(input.sku) : undefined);
  if (!item) {
    return notFound(
      `Specify which item: order ${hit.order.id} has items [${hit.order.items.map((i) => i.sku).join(', ')}].`,
    );
  }
  return { output: checkItemEligibility(item, hit.order), isError: false };
}

async function checkCustomerStandingTool(customerId: string): Promise<ToolResult> {
  const customer = await store.getById(customerId);
  if (!customer) return notFound('Your account could not be loaded.');
  return { output: checkCustomerStanding(customer), isError: false };
}

async function calculateRefundAmount(input: Input, customerId: string): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const item = resolveItem(hit.order, input.sku ? String(input.sku) : undefined);
  if (!item) return notFound(`Specify which item to calculate for in order ${hit.order.id}.`);
  return {
    output: { ...calculateRefund(item), highValue: checkHighValue(hit.order) },
    isError: false,
  };
}

async function requestRefundConfirmation(input: Input, ctx: ToolContext): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(ctx.customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const item = resolveItem(hit.order, input.sku ? String(input.sku) : undefined);
  if (!item) return notFound(`Specify which item to refund in order ${hit.order.id}.`);

  // Only ever confirm something that is genuinely refundable — re-validate first,
  // so a confirmation card can't be shown for an ineligible item.
  const blockers = assessBlockers(hit.customer, hit.order, item);
  if (blockers.length > 0) {
    return {
      output: {
        confirmationRequired: false,
        refused: true,
        reason: 'This item is not eligible to refund — there is nothing to confirm.',
        blockers,
        policyRefs: [...new Set(blockers.flatMap((b) => b.policyRefs))],
        recommendedAction: recommendedActionFor(blockers),
      },
      isError: true,
    };
  }

  // Record the confirmation request. Only the FIRST request this session marks
  // the order as "asked this turn" (so re-confirming on the customer's yes-turn
  // doesn't re-block processing).
  if (!ctx.sessionConfirmations.has(hit.order.id)) {
    ctx.confirmRequestedThisTurn.add(hit.order.id);
  }
  ctx.sessionConfirmations.add(hit.order.id);

  const calc = calculateRefund(item);
  return {
    output: {
      confirmationRequired: true,
      orderId: hit.order.id,
      sku: item.sku,
      item: item.name,
      refundAmount: calc.refundAmount,
      restockingFee: calc.restockingFee,
      method: hit.order.paymentMethod,
    },
    isError: false,
  };
}

async function processRefund(input: Input, ctx: ToolContext): Promise<ToolResult> {
  const { customerId, emit } = ctx;
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const item = resolveItem(hit.order, input.sku ? String(input.sku) : undefined);
  if (!item) return notFound(`Specify which item to refund in order ${hit.order.id}.`);

  // Confirmation gate — enforce the confirm-first flow server-side, not just in
  // the prompt. A refund requires a confirmation the customer actually saw and
  // replied to, which means it must have been requested in an EARLIER turn.
  if (!ctx.sessionConfirmations.has(hit.order.id)) {
    return {
      output: {
        refused: true,
        reason:
          'No confirmation on record. Call request_refund_confirmation first and wait for the customer to confirm before processing.',
        recommendedAction: 'request_refund_confirmation',
      },
      isError: true,
    };
  }
  if (ctx.confirmRequestedThisTurn.has(hit.order.id)) {
    return {
      output: {
        refused: true,
        reason:
          'You just asked the customer to confirm this refund — end your turn and wait. Only call process_refund in a later turn, after they have confirmed.',
      },
      isError: true,
    };
  }

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
      // Awaited write-through: a DB failure here surfaces as a failed refund below
      // (no phantom success), and persistence is idempotent + transactional.
      await store.applyRefund(hit.order.id, calc.refundAmount, receipt.confirmation, item.sku);
      ctx.sessionConfirmations.delete(hit.order.id); // consume — a new refund needs a new confirmation
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
          // Simulated post-refund notification (no real email is sent — same
          // mock spirit as the payment gateway). Aria relays this to the customer.
          notification: {
            channel: 'email',
            to: hit.customer.email,
            returnLabel: item.condition !== 'defective',
          },
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

async function denyRefund(input: Input, customerId: string): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(customerId, orderId);
  if (!hit) return NOT_ON_ACCOUNT(orderId);
  const reason = String(input.reason ?? 'Not eligible under policy.');
  const policyRefs = stringArray(input.policyRefs);
  return {
    output: { recorded: true, outcome: 'denied', orderId: hit.order.id, reason, policyRefs },
    isError: false,
    decision: { outcome: 'denied', detail: reason, orderId: hit.order.id, policyRefs },
  };
}

async function escalateToHuman(input: Input, customerId: string): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(customerId, orderId);
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

async function requestPhotoEvidence(input: Input, customerId: string): Promise<ToolResult> {
  const orderId = String(input.orderId ?? '');
  const hit = await resolveOwned(customerId, orderId);
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
  const { customerId } = ctx;

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
    case 'request_refund_confirmation':
      return requestRefundConfirmation(input, ctx);
    case 'process_refund':
      return processRefund(input, ctx);
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
