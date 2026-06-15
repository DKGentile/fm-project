/**
 * HTTP DTOs exchanged between the server and the web client.
 */

import type { Channel, DecisionOutcome } from './events';

export interface SessionSummary {
  id: string;
  channel: Channel;
  startedAt: number;
  lastActivity: number;
  /** The authenticated customer this conversation belongs to. */
  customerName?: string;
  /** First customer message, for a readable label. */
  title: string;
  messageCount: number;
  toolCallCount: number;
  retryCount: number;
  decisions: DecisionOutcome[];
}

export interface Metrics {
  sessions: number;
  decisions: number;
  approved: number;
  denied: number;
  escalated: number;
  infoRequested: number;
  toolCalls: number;
  retries: number;
  /** Average tool calls per decision (orchestration depth). */
  avgToolsPerDecision: number;
}

export interface AdminState {
  metrics: Metrics;
  sessions: SessionSummary[];
}

export interface AppConfig {
  model: string;
  effort: string;
  voiceProvider: 'elevenlabs' | 'browser';
  flakyGateway: boolean;
}
