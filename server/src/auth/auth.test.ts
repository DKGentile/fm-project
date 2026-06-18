/**
 * Auth + account-scoping tests. Verify login works only with a real email + the
 * demo password, and that order lookups are scoped to the owning customer (so a
 * customer can't reach another customer's order just by naming its number).
 */

import '../testSetup.js'; // must be first — forces the hermetic JSON backend
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, logout, customerIdForToken } from './auth.js';
import { store } from '../crm/store.js';

test('login succeeds with a real email + the demo password', async () => {
  const result = await login('alice.nguyen@example.com', 'password');
  assert.ok(result);
  assert.equal(result!.customer.email, 'alice.nguyen@example.com');
  assert.equal(customerIdForToken(result!.token), result!.customer.id);
});

test('login fails with the wrong password', async () => {
  assert.equal(await login('alice.nguyen@example.com', 'wrong'), null);
});

test('login fails for an unknown email', async () => {
  assert.equal(await login('nobody@example.com', 'password'), null);
});

test('logout invalidates the token', async () => {
  const result = await login('frank.li@example.com', 'password');
  assert.ok(result);
  logout(result!.token);
  assert.equal(customerIdForToken(result!.token), undefined);
});

test('findByEmail is case-insensitive', async () => {
  assert.equal((await store.findByEmail('ALICE.NGUYEN@EXAMPLE.COM'))?.id, 'C001');
});

test('findOwnedOrder scopes to the owning customer (no cross-account access)', async () => {
  const alice = await store.findByEmail('alice.nguyen@example.com');
  assert.ok(alice);
  // Alice owns O1001 but NOT Bob's O1002.
  assert.ok(await store.findOwnedOrder(alice!.id, 'O1001'));
  assert.equal(await store.findOwnedOrder(alice!.id, 'O1002'), undefined);
});
