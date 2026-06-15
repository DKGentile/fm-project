import type { DecisionOutcome } from '@northwind/shared';

export interface ToolDecision {
  outcome: DecisionOutcome;
  detail: string;
  orderId?: string;
  amount?: number;
  policyRefs?: string[];
}

export interface ToolResult {
  output: unknown;
  isError: boolean;
  /** Present on terminal tools — surfaced as a `decision` event + metric. */
  decision?: ToolDecision;
}
