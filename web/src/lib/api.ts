import type { AdminState, AgentEvent, AppConfig, Customer } from '@northwind/shared';

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch('/api/config');
  return res.json();
}

export async function getAdminState(): Promise<AdminState> {
  const res = await fetch('/api/admin/state');
  return res.json();
}

export async function getSessionEvents(id: string): Promise<AgentEvent[]> {
  const res = await fetch(`/api/admin/session/${encodeURIComponent(id)}`);
  return res.json();
}

export async function getCrm(): Promise<{ customers: Customer[] }> {
  const res = await fetch('/api/crm');
  return res.json();
}

export async function getPolicy(): Promise<string> {
  const res = await fetch('/api/policy');
  return res.text();
}

export async function resetDemo(): Promise<void> {
  await fetch('/api/admin/reset', { method: 'POST' });
}

/** Thrown when the chat endpoint rejects the bearer token (401). */
export class UnauthorizedError extends Error {
  constructor() {
    super('Your session has expired. Please log in again.');
    this.name = 'UnauthorizedError';
  }
}

/** Stream one agent turn, parsing the SSE response and calling onEvent per event. */
export async function streamChat(
  params: { sessionId: string; message: string; channel: 'chat' | 'voice'; token: string },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { token, ...body } = params;
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok || !res.body) {
    throw new Error(`Chat request failed (${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        try {
          onEvent(JSON.parse(json) as AgentEvent);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }
}

/** Subscribe to the global admin event stream. Returns an unsubscribe fn. */
export function openAdminStream(onEvent: (e: AgentEvent) => void): () => void {
  const es = new EventSource('/api/admin/stream');
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as AgentEvent);
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}

// ───────────────────────── auth ─────────────────────────

export interface PublicCustomer {
  id: string;
  name: string;
  email: string;
}

export interface DemoAccount {
  id: string;
  name: string;
  email: string;
  scenario: string;
  orderCount: number;
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; customer: PublicCustomer }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Login failed.');
  }
  return res.json();
}

export async function logout(token: string): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

export async function getDemoAccounts(): Promise<DemoAccount[]> {
  const res = await fetch('/api/auth/demo-accounts');
  const data = (await res.json()) as { accounts: DemoAccount[] };
  return data.accounts;
}
