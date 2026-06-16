/**
 * Northwind Refund Agent — server bootstrap.
 * See app.ts for the route wiring and http/routes/* for the handlers.
 */

import { config } from './config.js';
import { createApp } from './app.js';
import { store } from './crm/store.js';

await store.init();

createApp().listen(config.port, () => {
  console.log(`\n  Northwind Refund Agent server`);
  console.log(`  ▸ http://localhost:${config.port}`);
  console.log(`  ▸ model: ${config.model}  effort: ${config.effort}  voice: ${config.voiceProvider}`);
  console.log(`  ▸ flaky gateway: ${config.flakyGateway ? 'on (refunds retry once)' : 'off'}`);
  if (!config.hasApiKey) {
    console.log(`  ⚠ ANTHROPIC_API_KEY not set — the agent will not run until you add it to .env\n`);
  } else {
    console.log('');
  }
});
