/**
 * Authentication endpoints (mounted at /api/auth):
 *   POST /login           { email, password } → { token, customer }
 *   POST /logout          invalidate the bearer token
 *   GET  /demo-accounts   names/emails/scenarios for the demo login picker
 */

import { Router, type Request, type Response } from 'express';
import { login, logout } from '../../auth/auth.js';
import { store } from '../../crm/store.js';
import { getBearerToken } from '../bearer.js';

export const authRouter = Router();

authRouter.post('/login', async (req: Request, res: Response) => {
  const email = String(req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');
  const result = await login(email, password);
  if (!result) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  res.json(result);
});

authRouter.post('/logout', (req: Request, res: Response) => {
  logout(getBearerToken(req));
  res.json({ ok: true });
});

// Demo convenience only — lets the login screen list the test accounts. A real
// app would never expose its customer directory like this.
authRouter.get('/demo-accounts', async (_req, res) => {
  const customers = await store.all();
  res.json({
    accounts: customers.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      scenario: c.scenario ?? '',
      orderCount: c.orders.length,
    })),
  });
});
