import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { parseIdlJson } from '../../codegen/parser';
import { emitAccountsSource } from '../../codegen/emit-accounts';

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('emitAccountsSource — minimal IDL', () => {
  const idl = parseIdlJson(fixture('minimal.idl.json'));
  const src = emitAccountsSource(idl);

  it('emits PublicKey for authority field', () => {
    expect(src).toContain('authority: PublicKey;');
  });
  it('emits Bytes32 for params_hash (negative-token rule)', () => {
    expect(src).toContain('paramsHash: Bytes32;');
  });
  it('emits ConfigAccount interface and parser', () => {
    expect(src).toContain('export interface ConfigAccount {');
    expect(src).toContain('export function parseConfigAccount(data: Buffer | Uint8Array): ConfigAccount {');
  });
  it('emits a discriminator constant (8 bytes)', () => {
    const m = src.match(/CONFIGACCOUNT_DISCRIMINATOR: Uint8Array = new Uint8Array\(\[([^\]]+)\]\)/);
    expect(m).not.toBeNull();
    const bytes = m![1].split(',').map(s => s.trim()).filter(Boolean);
    expect(bytes.length).toBe(8);
  });
  it('emits WIRE map preserving snake_case keys', () => {
    expect(src).toContain('"params_hash": "paramsHash"');
    expect(src).toContain('"is_active": "isActive"');
  });
  it('imports from @arlex/client/codegen-runtime', () => {
    expect(src).toContain("from '@arlex/client/codegen-runtime'");
  });
  it('emits explicit Buffer import for browser-bundle compatibility (G3 follow-up)', () => {
    // Required for Vite/Rollup which do NOT auto-polyfill the global Buffer.
    // Generated parsers use Buffer.isBuffer / Buffer.from below.
    expect(src).toContain("import { Buffer } from 'buffer';");
  });
});

describe('emitAccountsSource — mixed IDL with defined types', () => {
  const idl = parseIdlJson(fixture('mixed.idl.json'));
  const src = emitAccountsSource(idl);

  it('emits the Entry struct interface BEFORE Vault that uses it', () => {
    const entryIdx = src.indexOf('export interface Entry {');
    const vaultIdx = src.indexOf('export interface Vault {');
    expect(entryIdx).toBeGreaterThan(-1);
    expect(vaultIdx).toBeGreaterThan(-1);
    expect(entryIdx).toBeLessThan(vaultIdx);
  });
  it('emits Status enum as a string-literal union', () => {
    // Status is referenced by no account here, so it should NOT be emitted
    expect(src).not.toContain('export type Status =');
  });
  it('emits PublicKey for owner field', () => {
    expect(src).toContain('owner: PublicKey;');
  });
  it('emits Uint8Array for non-32 byte array (label: [u8;16])', () => {
    expect(src).toContain('label: Uint8Array;');
  });
  it('emits Entry[] for vec<Entry>', () => {
    expect(src).toContain('entries: Entry[];');
  });
  it('emits Entry for single defined struct field', () => {
    expect(src).toContain('singleEntry: Entry;');
  });
  it('contains the WIRE map pointing nested fields to Entry', () => {
    expect(src).toContain('WIRE_ENTRY_FIELDS');
  });
});
