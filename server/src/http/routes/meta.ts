/**
 * Read-only metadata endpoints (mounted at /api):
 *   GET /config   model / effort / voice provider / flaky-gateway
 *   GET /crm      the CRM data (admin viewer)
 *   GET /policy   the refund policy markdown
 */

import { Router } from 'express';
import { config } from '../../config.js';
import { store } from '../../crm/store.js';
import { POLICY_MARKDOWN } from '../../policy/policyDocument.js';

export const metaRouter = Router();

metaRouter.get('/config', (_req, res) => {
  res.json({
    model: config.model,
    effort: config.effort,
    voiceProvider: config.voiceProvider,
    flakyGateway: config.flakyGateway,
  });
});

metaRouter.get('/crm', (_req, res) => res.json({ customers: store.all() }));

metaRouter.get('/policy', (_req, res) => res.type('text/markdown').send(POLICY_MARKDOWN));
