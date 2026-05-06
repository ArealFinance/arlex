/**
 * Helpers for validator-gated smoke tests.
 *
 * `isValidatorReachable()` probes the local Solana test validator with a
 * 1-second timeout. Tests that depend on it should `it.skipIf(!ok)` so
 * that running `npm test` without a validator stays green.
 */
import { Connection, PublicKey } from '@solana/web3.js';

export const LOCAL_VALIDATOR_URL = 'http://127.0.0.1:8899';

export async function isValidatorReachable(timeoutMs = 1000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(LOCAL_VALIDATOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return typeof (body as { result?: unknown }).result !== 'undefined';
  } catch {
    return false;
  }
}

export async function fetchKnownAccount(programId: PublicKey, address: PublicKey): Promise<Buffer | null> {
  const conn = new Connection(LOCAL_VALIDATOR_URL, 'confirmed');
  const info = await conn.getAccountInfo(address, 'confirmed');
  if (!info) return null;
  if (!info.owner.equals(programId)) return null;
  return info.data;
}
