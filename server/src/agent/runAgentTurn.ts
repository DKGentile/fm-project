/**
 * The agent loop — a manual Claude tool-calling loop with streaming.
 *
 * Per user turn it:
 *   stream a response  →  emit thinking + text + (tool calls)
 *   if Claude asked for tools: execute them, emit results/decisions, loop
 *   else: finish the turn
 *
 * Reasoning, tool calls/results, retries, and decisions are all emitted as
 * AgentEvents so the admin dashboard mirrors the agent's thought process live.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Channel, Customer, Emit } from '@northwind/shared';
import { config } from '../config.js';
import { errorMessage } from '../llm/anthropic.js';
import { getOrCreateSession } from '../events/sessionStore.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { streamAssistant } from './streaming.js';
import { executeTool } from './tools/executor.js';

const MAX_AGENT_TURNS = 8;

/** One in-flight turn per session id — prevents interleaved writes to the
 *  shared message history when the same session is hit concurrently. */
const activeSessions = new Set<string>();

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export interface RunTurnOptions {
  sessionId: string;
  channel: Channel;
  userText: string;
  emit: Emit;
  /** The authenticated customer — the agent is scoped to this account. */
  customer: Customer;
  /** Aborted when the client disconnects mid-stream. */
  signal?: AbortSignal;
}

export async function runAgentTurn({
  sessionId,
  channel,
  userText,
  emit,
  customer,
  signal,
}: RunTurnOptions): Promise<void> {
  const session = getOrCreateSession(sessionId, channel);
  session.customerName = customer.name;

  // Reject overlapping turns on the same session so concurrent requests can't
  // interleave pushes into the shared history (which would break the API's
  // user/assistant alternation + tool_use/tool_result pairing).
  if (activeSessions.has(sessionId)) {
    emit({
      type: 'error',
      message: 'A request is already being processed for this session — please wait for it to finish.',
    });
    emit({ type: 'turn_complete' });
    return;
  }

  if (session.messages.length === 0) emit({ type: 'session_start', channel });
  emit({ type: 'user_message', text: userText, channel });

  if (!config.hasApiKey) {
    emit({
      type: 'error',
      message:
        'ANTHROPIC_API_KEY is not set on the server. Add it to your .env file and restart the server.',
    });
    emit({ type: 'turn_complete' });
    return;
  }

  activeSessions.add(sessionId);
  // Snapshot history length so we can drop a failed/aborted turn cleanly and
  // never leave a dangling user message or unanswered tool_use behind.
  const rollbackLen = session.messages.length;
  session.messages.push({ role: 'user', content: userText });
  const system = buildSystemPrompt(customer);
  let success = false;

  try {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      if (signal?.aborted) break;
      const final = await streamAssistant(session.messages, system, emit, signal);
      // Push the full content (incl. thinking blocks) back unchanged for the next turn.
      session.messages.push({ role: 'assistant', content: final.content as any });

      const text = extractText(final.content);
      if (text.trim()) emit({ type: 'assistant_message', text });

      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      // Answer any tool_use blocks even if the stop reason was max_tokens, so we
      // never persist an assistant tool_use without a matching tool_result.
      if (toolUses.length === 0) {
        success = true;
        break;
      }

      const results = await runTools(toolUses, emit, customer.id);
      session.messages.push({ role: 'user', content: results });

      if (turn === MAX_AGENT_TURNS - 1) {
        emit({ type: 'error', message: 'Reached the maximum number of tool-use turns for this request.' });
      }
    }
  } catch (err) {
    emit({ type: 'error', message: errorMessage(err) });
  } finally {
    // Keep history only if the turn ended cleanly; otherwise discard it so the
    // next turn starts from a valid, well-paired conversation prefix.
    if (!success) session.messages.length = rollbackLen;
    activeSessions.delete(sessionId);
    emit({ type: 'turn_complete' });
  }
}

/** Execute each requested tool, emitting call/result/decision events. */
async function runTools(
  toolUses: Anthropic.ToolUseBlock[],
  emit: Emit,
  customerId: string,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const tu of toolUses) {
    emit({ type: 'tool_call', tool: tu.name, toolUseId: tu.id, input: tu.input });
    const started = Date.now();
    const { output, isError, decision } = await executeTool(tu.name, tu.input, { emit, customerId });
    emit({
      type: 'tool_result',
      tool: tu.name,
      toolUseId: tu.id,
      output,
      isError,
      durationMs: Date.now() - started,
    });
    if (decision) {
      emit({
        type: 'decision',
        outcome: decision.outcome,
        detail: decision.detail,
        orderId: decision.orderId,
        amount: decision.amount,
        policyRefs: decision.policyRefs,
      });
    }
    results.push({
      type: 'tool_result',
      tool_use_id: tu.id,
      content: JSON.stringify(output),
      is_error: isError,
    });
  }
  return results;
}
