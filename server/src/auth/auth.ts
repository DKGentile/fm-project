/**
 * Minimal customer authentication for the demo.
 *
 * Login requires the email of a real CRM customer + the shared demo password.
 * A successful login mints an in-memory bearer token bound to that customer id;
 * the chat endpoint resolves the token back to a customer and SCOPES the agent
 * to that customer's account, so a caller can never act on someone else's orders
 * just by naming their order number.
 *
 * (In-memory tokens are fine for a demo — they reset on server restart. A real
 *  system would use hashed passwords + signed/expiring tokens.)
 */

import { randomUUID } from 'node:crypto';
import { store } from '../crm/store.js';

const DEMO_PASSWORD = 'password';

/** token → customerId */
const tokens = new Map<string, string>();

export interface PublicCustomer {
  id: string;
  name: string;
  email: string;
}

export interface LoginResult {
  token: string;
  customer: PublicCustomer;
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  if (password !== DEMO_PASSWORD) return null;
  const customer = await store.findByEmail(email);
  if (!customer) return null;

  const token = randomUUID();
  tokens.set(token, customer.id);
  return { token, customer: { id: customer.id, name: customer.name, email: customer.email } };
}

export function logout(token: string | undefined): void {
  if (token) tokens.delete(token);
}

export function customerIdForToken(token: string | undefined): string | undefined {
  return token ? tokens.get(token) : undefined;
}
