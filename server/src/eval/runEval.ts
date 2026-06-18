/**
 * Policy eval runner. Runs each scenario as one real agent turn (concurrently),
 * classifies the decision from the terminal tool Aria reaches for, and scores it
 * against the policy-correct outcome. Read-only: it never calls process_refund.
 */

import type { AgentEventBody, EvalOutcome, EvalResult, EvalSummary } from '@northwind/shared';
import { config } from '../config.js';
import { store } from '../crm/store.js';
import { runAgentTurn } from '../agent/runAgentTurn.js';
import { deleteSession } from '../events/sessionStore.js';
import { SCENARIOS, type EvalScenario } from './scenarios.js';

const TERMINAL_OUTCOME: Record<string, EvalOutcome> = {
  request_refund_confirmation: 'approve',
  process_refund: 'approve',
  deny_refund: 'deny',
  escalate_to_human: 'escalate',
  request_photo_evidence: 'photo',
};

/** The agent's decision = the last terminal tool it reached for this turn. */
function classify(tools: string[]): EvalOutcome {
  for (let i = tools.length - 1; i >= 0; i--) {
    const outcome = TERMINAL_OUTCOME[tools[i]];
    if (outcome) return outcome;
  }
  return 'unknown';
}

async function runScenario(s: EvalScenario, runId: string, signal: AbortSignal): Promise<EvalResult> {
  const base = {
    id: s.id,
    label: s.label,
    category: s.category,
    rule: s.rule,
    message: s.message,
    expected: s.accept,
  };
  const customer = await store.findByEmail(s.email);
  if (!customer) return { ...base, got: 'unknown', pass: false };

  const tools: string[] = [];
  const emit = (body: AgentEventBody): void => {
    if (body.type === 'tool_call') tools.push(body.tool);
  };

  const sessionId = `eval-${runId}-${s.id}`;
  try {
    await runAgentTurn({ sessionId, channel: 'chat', userText: s.message, emit, customer, signal });
  } finally {
    deleteSession(sessionId); // keep eval runs out of the admin session list
  }

  const got = classify(tools);
  return { ...base, got, pass: s.accept.includes(got) };
}

/**
 * Run all scenarios with a small concurrency pool, streaming each result via
 * `onResult` as it lands. Returns the final tally.
 */
export async function runEvals(
  onResult: (r: EvalResult) => void,
  signal: AbortSignal,
  concurrency = 4,
): Promise<EvalSummary> {
  if (!config.hasApiKey) throw new Error('ANTHROPIC_API_KEY is not set — cannot run evals.');

  const runId = Date.now().toString(36);
  let next = 0;
  let passed = 0;

  async function worker(): Promise<void> {
    while (next < SCENARIOS.length && !signal.aborted) {
      const scenario = SCENARIOS[next++];
      const result = await runScenario(scenario, runId, signal);
      if (result.pass) passed++;
      if (!signal.aborted) onResult(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, SCENARIOS.length) }, worker));
  return { passed, total: SCENARIOS.length };
}
