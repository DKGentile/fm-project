/** Server-Sent Events helpers. */

import type { Response } from 'express';
import type { AgentEvent } from '@northwind/shared';

export function openSse(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

export function writeSse(res: Response, event: AgentEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Write an arbitrary JSON payload as one SSE `data:` frame (non-AgentEvent streams). */
export function writeSseJson(res: Response, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** SSE comment line — keeps the connection alive without delivering an event. */
export function writeSseComment(res: Response, text: string): void {
  res.write(`: ${text}\n\n`);
}
