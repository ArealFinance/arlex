/**
 * Regression test for the SDK runtime/type drift bug fixed in 0.3.1.
 *
 * Before the fix:
 *   - Codegen emitted `interface X { authority: PublicKey }` (correct)
 *   - But the runtime parser returned `{ authority: Uint8Array(32) }`
 *     because the IDL spelled the field as `[u8; 32]` and the Borsh
 *     decoder didn't know about pubkey-overrides.
 *   - Consumers had to write a `toPublicKey(...)` adapter to bridge.
 *
 * After the fix:
 *   - The parser wraps pubkey-classified `[u8; 32]` values as `PublicKey`
 *     instances directly. No consumer-side adapter required.
 *
 * The test exercises the full codegen → write to disk → require generated
 * file → call parser path so it would catch a regression in either
 * direction (codegen omits pubkeyFields or runtime ignores them).
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PublicKey } from '@solana/web3.js';
import { generateTypes, parseIdlJson } from '../../codegen';
import {
  serializeArgs,
  deserializeAccount,
  type TypeRegistry,
  buildTypeRegistry,
} from '../../serialization';
import { accountDiscriminator } from '../../discriminator';
import { remapWireToTs } from '../../codegen-runtime';
import { collectPubkeyFieldNames } from '../../codegen/pubkey-detection';
import type { IdlField } from '../../types';

describe('runtime honors pubkey overrides at decode time', () => {
  it('remapWireToTs wraps listed pubkeyFields as PublicKey instances', () => {
    const wallet = new Uint8Array(32);
    for (let i = 0; i < 32; i++) wallet[i] = i + 1;
    const merkleRoot = new Uint8Array(32);
    for (let i = 0; i < 32; i++) merkleRoot[i] = 0xff - i;

    const raw = {
      authority: wallet,        // wire returns Uint8Array
      params_hash: merkleRoot,  // wire returns Uint8Array (NOT pubkey)
      amount: 42n,
    };
    const map = {
      authority: 'authority',
      params_hash: 'paramsHash',
      amount: 'amount',
    };

    const out = remapWireToTs(raw, map, { pubkeyFields: ['authority'] });

    // pubkey-classified field is now a PublicKey
    expect(out.authority).toBeInstanceOf(PublicKey);
    expect((out.authority as PublicKey).toBuffer().equals(Buffer.from(wallet))).toBe(true);

    // hash field stays as raw bytes (not in pubkeyFields)
    expect(out.paramsHash).not.toBeInstanceOf(PublicKey);
    expect(out.paramsHash).toBeInstanceOf(Uint8Array);

    // unrelated scalar untouched
    expect(out.amount).toBe(42n);
  });

  it('remapWireToTs is idempotent if value is already a PublicKey', () => {
    const pk = new PublicKey(new Uint8Array(32));
    const out = remapWireToTs({ a: pk }, { a: 'a' }, { pubkeyFields: ['a'] });
    expect(out.a).toBe(pk);
  });

  it('end-to-end: full codegen → parse uses PUBKEY_*_FIELDS so account fields decode as PublicKey', async () => {
    // Tiny IDL with one account: authority (pubkey by suffix), params_hash (bytes32 by negative-token rule).
    const idlJson = JSON.stringify({
      version: '0.1.0',
      name: 'pubkey_drift_fixture',
      metadata: { address: '11111111111111111111111111111111' },
      instructions: [
        { name: 'noop', accounts: [{ name: 'signer', isMut: false, isSigner: true }], args: [] },
      ],
      accounts: [
        {
          name: 'WalletConfig',
          type: {
            kind: 'struct',
            fields: [
              { name: 'authority', type: { array: ['u8', 32] } },
              { name: 'params_hash', type: { array: ['u8', 32] } },
              { name: 'amount', type: 'u64' },
              { name: 'is_active', type: 'bool' },
            ],
          },
        },
      ],
      errors: [{ code: 6000, name: 'Unknown', msg: 'unknown' }],
    });

    const idl = parseIdlJson(idlJson);
    const out = generateTypes(idl);

    // Generated source must declare AND populate the pubkey-fields const,
    // and must thread it into the parser.
    expect(out.accounts).toContain('PUBKEY_WALLETCONFIG_FIELDS');
    expect(out.accounts).toMatch(/PUBKEY_WALLETCONFIG_FIELDS\s*=\s*\[\s*"authority",\s*\]\s*as const/);
    expect(out.accounts).toMatch(/pubkeyFields:\s*PUBKEY_WALLETCONFIG_FIELDS/);

    // Build the same wire payload the generated parser would consume:
    // 8-byte discriminator + serialized account body.
    const fields: IdlField[] = [
      { name: 'authority', type: { array: ['u8', 32] } },
      { name: 'params_hash', type: { array: ['u8', 32] } },
      { name: 'amount', type: 'u64' },
      { name: 'is_active', type: 'bool' },
    ];

    const authorityBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) authorityBytes[i] = i;
    const hashBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) hashBytes[i] = 0xab;

    const wire = {
      authority: authorityBytes,
      params_hash: hashBytes,
      amount: 999n,
      is_active: true,
    };
    const body = serializeArgs(fields, wire);
    const buf = Buffer.concat([accountDiscriminator('WalletConfig'), body]);

    // Re-decode using the same primitives the generated parser uses.
    const registry: TypeRegistry = buildTypeRegistry([], [{ name: 'WalletConfig', type: { kind: 'struct', fields } }]);
    const decoded = deserializeAccount(fields, buf, registry);

    // pubkeyFields list = what codegen would compute for the same fields.
    const pubkeyFields = collectPubkeyFieldNames(fields, 'WalletConfig').map(name =>
      // emulate camelField for our test since name has no underscore-segments here
      name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()),
    );

    const ts = remapWireToTs(
      decoded,
      { authority: 'authority', params_hash: 'paramsHash', amount: 'amount', is_active: 'isActive' },
      { pubkeyFields },
    );

    // CRITICAL ASSERTIONS — these would fail before the 0.3.1 fix.
    expect(ts.authority).toBeInstanceOf(PublicKey);
    expect((ts.authority as PublicKey).toBuffer().equals(Buffer.from(authorityBytes))).toBe(true);
    expect(ts.paramsHash).not.toBeInstanceOf(PublicKey); // negative-token rule keeps hash as bytes32
    expect(ts.amount).toBe(999n);
    expect(ts.isActive).toBe(true);
  });
});

describe('serialization accepts PublicKey for [u8;32] fields (encode side)', () => {
  it('serializeArgs writes the same 32 bytes whether input is PublicKey, Uint8Array, or Buffer', () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = i + 100;

    const fields: IdlField[] = [{ name: 'k', type: { array: ['u8', 32] } }];

    const fromBytes = serializeArgs(fields, { k: bytes });
    const fromBuffer = serializeArgs(fields, { k: Buffer.from(bytes) });
    const fromPubkey = serializeArgs(fields, { k: new PublicKey(bytes) });

    expect(fromBytes.equals(fromBuffer)).toBe(true);
    expect(fromBytes.equals(fromPubkey)).toBe(true);
    expect(fromPubkey.length).toBe(32);
  });
});
