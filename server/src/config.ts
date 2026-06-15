/**
 * Central configuration — the single place that reads process.env.
 * Importing this also loads the repo-root .env (via ./env).
 */
import './env.js';

export type Effort = 'low' | 'medium' | 'high' | 'max';
export type VoiceProvider = 'elevenlabs' | 'browser';

const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || undefined;

export const config = {
  port: Number(process.env.PORT ?? 8787),

  /** Best reasoning for "holding the line"; override to claude-sonnet-4-6 for speed. */
  model: process.env.AGENT_MODEL?.trim() || 'claude-opus-4-8',
  effort: (process.env.AGENT_EFFORT?.trim() || 'medium') as Effort,

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),

  /** First refund attempt per order fails, to demo retry handling. */
  flakyGateway: (process.env.FLAKY_GATEWAY ?? 'true').toLowerCase() !== 'false',

  elevenLabsApiKey,
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || '21m00Tcm4TlvDq8ikWAM',
  voiceProvider: (elevenLabsApiKey ? 'elevenlabs' : 'browser') as VoiceProvider,
} as const;
