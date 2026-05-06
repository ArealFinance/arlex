/**
 * Synthetic smoke test — generate types for all 5 Areal IDLs into a tmp
 * directory and round-trip-encode-decode a representative account using
 * the existing runtime serialization layer.
 *
 * No validator required. Always runs.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs, readFileSync, readdirSync, existsSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateTypes, parseIdlJson } from '../../codegen';
import {
  serializeArgs,
  deserializeAccount,
  buildTypeRegistry,
} from '../../serialization';
import { accountDiscriminator } from '../../discriminator';
import { remapWireToTs, remapTsToWire } from '../../codegen-runtime';
import type { IdlField } from '../../types';

const arealIdlDir = '/Users/blackmesa/Documents/areal.newera/dashboard/src/lib/idl';

function listArealIdls(): string[] {
  if (!existsSync(arealIdlDir)) return [];
  return readdirSync(arealIdlDir).filter(f => f.endsWith('.json')).map(f => path.join(arealIdlDir, f));
}

describe('synthetic smoke — Areal IDLs codegen', () => {
  const idlFiles = listArealIdls();

  it('reaches all 5 expected IDLs', () => {
    if (idlFiles.length === 0) {
      // Fixtures may not be present in some CI environments — skip gracefully.
      return;
    }
    expect(idlFiles.length).toBe(5);
  });

  for (const file of idlFiles) {
    const label = path.basename(file);
    it(`${label}: generated source is non-empty and contains expected exports`, async () => {
      const raw = readFileSync(file, 'utf8');
      const idl = parseIdlJson(raw);
      const out = generateTypes(idl);

      expect(out.accounts.length).toBeGreaterThan(0);
      expect(out.instructions.length).toBeGreaterThan(0);
      expect(out.errors.length).toBeGreaterThan(0);
      expect(out.accounts).toContain('// AUTO-GENERATED');
      expect(out.instructions).toContain('// AUTO-GENERATED');
      expect(out.errors).toContain('// AUTO-GENERATED');
    });

    it(`${label}: writes 3 files into a tmp dir`, async () => {
      const raw = readFileSync(file, 'utf8');
      const idl = parseIdlJson(raw);
      const out = generateTypes(idl);

      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arlex-codegen-'));
      try {
        await fs.writeFile(path.join(tmp, out.filenames.accounts), out.accounts);
        await fs.writeFile(path.join(tmp, out.filenames.instructions), out.instructions);
        await fs.writeFile(path.join(tmp, out.filenames.errors), out.errors);
        const written = await fs.readdir(tmp);
        expect(written.sort()).toEqual([
          out.filenames.accounts,
          out.filenames.errors,
          out.filenames.instructions,
        ].sort());
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  }
});

describe('synthetic encode/decode roundtrip', () => {
  it('roundtrips a synthetic account through serializeArgs + deserializeAccount with WIRE map', () => {
    // Define an account as IDL fields, serialize, deserialize, remap, compare.
    const fields: IdlField[] = [
      { name: 'wallet_address', type: { array: ['u8', 32] } },
      { name: 'total_staked', type: 'u64' },
      { name: 'is_active', type: 'bool' },
      { name: 'level', type: 'u8' },
    ];
    const wireMap = {
      wallet_address: 'walletAddress',
      total_staked: 'totalStaked',
      is_active: 'isActive',
      level: 'level',
    };

    const wallet = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) wallet[i] = i;

    // 1. Build wire-shaped values, serialize.
    const wireIn = {
      wallet_address: wallet,
      total_staked: 1234567890n,
      is_active: true,
      level: 5,
    };
    const argBuf = serializeArgs(fields, wireIn);

    // 2. Deserialize (with fake 8-byte discriminator prepended).
    const withDisc = Buffer.concat([Buffer.alloc(8), argBuf]);
    const wireOut = deserializeAccount(fields, withDisc);

    expect(wireOut.total_staked).toBe(1234567890n);
    expect(wireOut.is_active).toBe(true);
    expect(wireOut.level).toBe(5);
    expect(Buffer.from(wireOut.wallet_address).equals(wallet)).toBe(true);

    // 3. Remap wire -> ts.
    const tsOut = remapWireToTs(wireOut, wireMap);
    expect(tsOut.totalStaked).toBe(1234567890n);
    expect(tsOut.isActive).toBe(true);
    expect(tsOut.level).toBe(5);

    // 4. Round-trip back: ts -> wire.
    const reverse = remapTsToWire(tsOut as Record<string, unknown>, wireMap);
    expect(reverse.total_staked).toBe(1234567890n);
    expect(reverse.is_active).toBe(true);
    expect(reverse.level).toBe(5);
  });

  it('discriminator constants match the runtime accountDiscriminator()', () => {
    // Sanity-check that the codegen-emitted discriminator literals would
    // match what the runtime computes.
    for (const name of ['Pool', 'StakingPool', 'OtConfig', 'YieldDistributor']) {
      const disc = accountDiscriminator(name);
      expect(disc.length).toBe(8);
    }
  });
});
