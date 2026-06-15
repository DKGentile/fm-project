/**
 * ElevenLabs text-to-speech. Used only when a key is configured; otherwise the
 * web client falls back to the browser's built-in speechSynthesis.
 */

import { config } from '../config.js';

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  if (!config.elevenLabsApiKey) throw new Error('ELEVENLABS_API_KEY is not configured.');

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenLabsApiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.0 },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs error ${res.status}: ${detail.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
