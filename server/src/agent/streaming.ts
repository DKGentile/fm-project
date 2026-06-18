/**
 * Streams a single assistant response, emitting thinking + text events, with
 * API-level retry/backoff for transient errors (429/529/5xx/connection).
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Emit } from '@demitri/shared';
import { config } from '../config.js';
import { anthropic, errorMessage, isRetryableApiError } from '../llm/anthropic.js';
import { TOOLS } from './tools/definitions.js';

const MAX_API_ATTEMPTS = 4;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function streamAssistant(
  messages: Anthropic.MessageParam[],
  system: Anthropic.TextBlockParam[],
  emit: Emit,
  signal?: AbortSignal,
): Promise<Anthropic.Message> {
  for (let attempt = 1; ; attempt++) {
    // Track whether ANYTHING was streamed (thinking OR text), so a retry never
    // re-emits already-shown output.
    let emittedAny = false;
    const blockType = new Map<number, string>();
    const thinkingBuf = new Map<number, string>();

    try {
      // Cast to any: adaptive thinking + output_config.effort are newer than the
      // pinned SDK's static types, but valid at the API level.
      const params: any = {
        model: config.model,
        max_tokens: 16000,
        system,
        tools: TOOLS,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: config.effort },
        messages,
      };
      const stream = anthropic.messages.stream(params, { signal });

      for await (const ev of stream as AsyncIterable<any>) {
        if (ev.type === 'content_block_start') {
          blockType.set(ev.index, ev.content_block?.type);
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta?.type === 'thinking_delta') {
            thinkingBuf.set(ev.index, (thinkingBuf.get(ev.index) ?? '') + ev.delta.thinking);
          } else if (ev.delta?.type === 'text_delta') {
            emittedAny = true;
            emit({ type: 'assistant_delta', text: ev.delta.text });
          }
        } else if (ev.type === 'content_block_stop') {
          if (blockType.get(ev.index) === 'thinking') {
            const t = thinkingBuf.get(ev.index) ?? '';
            if (t.trim()) {
              emittedAny = true;
              emit({ type: 'thinking', text: t });
            }
          }
        }
      }
      return await stream.finalMessage();
    } catch (err) {
      // Only retry if nothing was streamed yet (so we don't duplicate output).
      if (isRetryableApiError(err) && !emittedAny && attempt < MAX_API_ATTEMPTS) {
        const nextDelayMs = 600 * attempt;
        emit({ type: 'api_retry', attempt, maxAttempts: MAX_API_ATTEMPTS, error: errorMessage(err), nextDelayMs });
        await delay(nextDelayMs);
        continue;
      }
      throw err;
    }
  }
}
