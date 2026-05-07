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

  // Phase 3.5 C.2: defined struct interfaces no longer live inline in
  // accounts.generated.ts. They are imported from
  // ./defined-types.generated.js. The emitter still references them by
  // name (in account interface fields and in nested-map literals), so we
  // verify the import + reference instead of the inline declaration.
  it('imports Entry from defined-types.generated.js', () => {
    expect(src).toContain("from './defined-types.generated.js';");
    // Entry is a struct so its interface name + WIRE_ENTRY_FIELDS + IDL_ENTRY_FIELDS
    // must all appear in the import block.
    expect(src).toMatch(/import \{[\s\S]*Entry,[\s\S]*\} from '\.\/defined-types\.generated\.js';/);
    expect(src).toMatch(/import \{[\s\S]*WIRE_ENTRY_FIELDS,[\s\S]*\} from '\.\/defined-types\.generated\.js';/);
    expect(src).toMatch(/import \{[\s\S]*IDL_ENTRY_FIELDS,[\s\S]*\} from '\.\/defined-types\.generated\.js';/);
  });
  it('does NOT inline Entry interface (lives in defined-types.generated.ts now)', () => {
    expect(src).not.toContain('export interface Entry {');
  });
  it('does NOT inline TYPE_REGISTRY (lives in defined-types.generated.ts now)', () => {
    expect(src).not.toContain('const TYPE_REGISTRY: TypeRegistry = buildTypeRegistry');
    // But it must IMPORT TYPE_REGISTRY since parsers use it.
    expect(src).toMatch(/import \{[\s\S]*TYPE_REGISTRY,[\s\S]*\} from '\.\/defined-types\.generated\.js';/);
  });
  it('does not emit Status enum (no account references it)', () => {
    // Status is referenced by no account here, so it should NOT be imported.
    // (defined-types.generated.ts may still emit it because instructions might
    // reference it, but accounts.generated.ts does not pull it in.)
    expect(src).not.toMatch(/import \{[\s\S]*Status,[\s\S]*\} from '\.\/defined-types\.generated\.js';/);
  });
  it('emits PublicKey for owner field', () => {
    expect(src).toContain('owner: PublicKey;');
  });
  it('emits Uint8Array for non-32 byte array (label: [u8;16])', () => {
    expect(src).toContain('label: Uint8Array;');
  });
  it('references Entry[] for vec<Entry>', () => {
    expect(src).toContain('entries: Entry[];');
  });
  it('references Entry for single defined struct field', () => {
    expect(src).toContain('singleEntry: Entry;');
  });
  it('uses WIRE_ENTRY_FIELDS in nested-map literal for Vault parser', () => {
    expect(src).toContain('WIRE_ENTRY_FIELDS');
  });
});
