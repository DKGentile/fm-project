/**
 * POST /api/tts — ElevenLabs text-to-speech (only when a key is configured;
 * otherwise the web client falls back to the browser's speech engine).
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../../config.js';
import { synthesizeSpeech } from '../../voice/tts.js';

export const voiceRouter = Router();

voiceRouter.post('/tts', async (req: Request, res: Response) => {
  if (config.voiceProvider !== 'elevenlabs') {
    res.status(501).json({ error: 'ElevenLabs TTS not configured; use the browser voice.' });
    return;
  }
  const text = String(req.body?.text ?? '').trim();
  if (!text) {
    res.status(400).json({ error: 'text is required.' });
    return;
  }
  try {
    const audio = await synthesizeSpeech(text.slice(0, 2000));
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
