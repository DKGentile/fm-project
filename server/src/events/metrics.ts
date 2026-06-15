/**
 * Derived admin views: per-session summaries and aggregate metrics, computed
 * from the running counters on each session record.
 */

import type { AdminState, Metrics, SessionSummary } from '@northwind/shared';
import { listSessionRecords, type SessionRecord } from './sessionStore.js';

function summarize(s: SessionRecord): SessionSummary {
  return {
    id: s.id,
    channel: s.channel,
    startedAt: s.startedAt,
    lastActivity: s.lastActivity,
    customerName: s.customerName,
    title: s.title,
    messageCount: s.messageCount,
    toolCallCount: s.toolCallCount,
    retryCount: s.retryCount,
    decisions: s.decisions,
  };
}

export function listSessions(): SessionSummary[] {
  return listSessionRecords()
    .map(summarize)
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

export function computeMetrics(): Metrics {
  const summaries = listSessions();
  let approved = 0;
  let denied = 0;
  let escalated = 0;
  let infoRequested = 0;
  let decisions = 0;
  let toolCalls = 0;
  let retries = 0;

  for (const s of summaries) {
    toolCalls += s.toolCallCount;
    retries += s.retryCount;
    for (const d of s.decisions) {
      decisions++;
      if (d === 'approved') approved++;
      else if (d === 'denied') denied++;
      else if (d === 'escalated') escalated++;
      else if (d === 'info_requested') infoRequested++;
    }
  }

  return {
    sessions: summaries.length,
    decisions,
    approved,
    denied,
    escalated,
    infoRequested,
    toolCalls,
    retries,
    avgToolsPerDecision: decisions ? Math.round((toolCalls / decisions) * 10) / 10 : 0,
  };
}

export function getAdminState(): AdminState {
  return { metrics: computeMetrics(), sessions: listSessions() };
}
