/**
 * The live agent-event stream — the typed contract that lets the admin
 * dashboard mirror the agent's reasoning faithfully.
 */

export type DecisionOutcome = 'approved' | 'denied' | 'escalated' | 'info_requested';

export type Channel = 'chat' | 'voice';

interface BaseEvent {
  /** Monotonic per-process id, useful for de-duping in the UI. */
  seq: number;
  sessionId: string;
  /** Epoch millis. */
  ts: number;
}

export type AgentEvent =
  | (BaseEvent & { type: 'session_start'; channel: Channel })
  | (BaseEvent & { type: 'user_message'; text: string; channel: Channel })
  | (BaseEvent & { type: 'thinking'; text: string })
  | (BaseEvent & { type: 'assistant_delta'; text: string })
  | (BaseEvent & { type: 'assistant_message'; text: string })
  | (BaseEvent & { type: 'tool_call'; tool: string; toolUseId: string; input: unknown })
  | (BaseEvent & {
      type: 'tool_result';
      tool: string;
      toolUseId: string;
      output: unknown;
      isError: boolean;
      durationMs: number;
    })
  | (BaseEvent & {
      type: 'tool_retry';
      tool: string;
      attempt: number;
      maxAttempts: number;
      error: string;
      nextDelayMs: number;
    })
  | (BaseEvent & {
      type: 'api_retry';
      attempt: number;
      maxAttempts: number;
      error: string;
      nextDelayMs: number;
    })
  | (BaseEvent & {
      type: 'decision';
      outcome: DecisionOutcome;
      detail: string;
      orderId?: string;
      amount?: number;
      policyRefs?: string[];
    })
  | (BaseEvent & { type: 'error'; message: string })
  | (BaseEvent & { type: 'turn_complete' });

export type AgentEventType = AgentEvent['type'];

/** Distributive Omit so we keep the union when stripping envelope fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An event as emitted inside the agent — the bus stamps seq/ts/sessionId. */
export type AgentEventBody = DistributiveOmit<AgentEvent, 'seq' | 'ts' | 'sessionId'>;

/** Emitter handed to the agent loop and tool executors. */
export type Emit = (body: AgentEventBody) => void;
