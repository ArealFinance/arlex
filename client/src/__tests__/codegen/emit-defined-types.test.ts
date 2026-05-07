/**
 * Phase 3.5 C.2 — per-program defined-types.generated.ts emitter.
 *
 * These tests exercise the new file-emission shape:
 *   - One file per program holds all `defined` struct/enum interfaces
 *     plus WIRE_*_FIELDS, IDL_*_FIELDS, and TYPE_REGISTRY.
 *   - accounts.generated.ts and instructions.generated.ts no longer
 *     duplicate any of the above — they `import { ... }` from
 *     './defined-types.generated.js' instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { parseIdlJson } from '../../codegen/parser';
import { emitDefinedTypesSource } from '../../codegen/emit-defined-types';
import { emitAccountsSource } from '../../codegen/emit-accounts';
import { emitInstructionsSource } from '../../codegen/emit-instructions';
import { generateTypes } from '../../codegen';

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('emitDefinedTypesSource — minimal IDL', () => {
  const idl = parseIdlJson(fixture('minimal.idl.json'));
  const src = emitDefinedTypesSource(idl);

  it('imports runtime types from @arlex/client/codegen-runtime', () => {
    expect(src).toContain("from '@arlex/client/codegen-runtime'");
    expect(src).toContain('buildTypeRegistry');
    expect(src).toContain('type WireFieldMap');
    expect(src).toContain('type IdlField');
    expect(src).toContain('type TypeRegistry');
  });

  it('exports TYPE_REGISTRY (program-wide, single source of truth)', () => {
    expect(src).toContain('export const TYPE_REGISTRY: TypeRegistry = buildTypeRegistry(');
  });

  it('does NOT import @arlex/client/codegen-runtime values it does not need', () => {
    // emit-defined-types should only pull in registry/wire/idl runtime
    // types and the value-types referenced in struct interfaces
    // (PublicKey, Bytes32) — NOT serializeArgs/deserializeAccount/etc.
    expect(src).not.toContain('serializeArgs');
    expect(src).not.toContain('deserializeAccount');
    expect(src).not.toContain('parseDiscriminator');
    expect(src).not.toContain('remapWireToTs');
    expect(src).not.toContain('remapTsToWire');
  });

  it('imports PublicKey and Bytes32 (defined struct fields may use them)', () => {
    expect(src).toContain('PublicKey');
    expect(src).toContain('type Bytes32');
  });
});

describe('emitDefinedTypesSource — mixed IDL with structs and enums', () => {
  const idl = parseIdlJson(fixture('mixed.idl.json'));
  const src = emitDefinedTypesSource(idl);

  it('emits the Entry struct interface', () => {
    expect(src).toContain('export interface Entry {');
  });

  it('emits Entry struct constants (WIRE + IDL field maps)', () => {
    expect(src).toContain('export const WIRE_ENTRY_FIELDS: WireFieldMap');
    expect(src).toContain('export const IDL_ENTRY_FIELDS: IdlField[]');
  });

  it('exports TYPE_REGISTRY', () => {
    expect(src).toContain('export const TYPE_REGISTRY: TypeRegistry =');
  });

  it('emits each defined type ONCE (no duplication within the file)', () => {
    const entryInterfaceMatches = src.match(/export interface Entry \{/g) ?? [];
    expect(entryInterfaceMatches.length).toBe(1);

    const entryWireMatches = src.match(/export const WIRE_ENTRY_FIELDS:/g) ?? [];
    expect(entryWireMatches.length).toBe(1);

    const entryIdlMatches = src.match(/export const IDL_ENTRY_FIELDS:/g) ?? [];
    expect(entryIdlMatches.length).toBe(1);
  });

  it('does not emit unused defined types (Status is referenced by nothing)', () => {
    // Status enum is declared in idl.types but no account or instruction
    // references it, so the collector should skip it.
    expect(src).not.toContain('export type Status =');
  });
});

describe('cross-file dedup — accounts/instructions do not re-emit defined types', () => {
  const idl = parseIdlJson(fixture('mixed.idl.json'));
  const accountsSrc = emitAccountsSource(idl);
  const instructionsSrc = emitInstructionsSource(idl);
  const definedSrc = emitDefinedTypesSource(idl);

  it('Entry interface lives ONLY in defined-types.generated.ts', () => {
    expect(definedSrc).toContain('export interface Entry {');
    expect(accountsSrc).not.toContain('export interface Entry {');
    expect(instructionsSrc).not.toContain('export interface Entry {');
  });

  it('TYPE_REGISTRY lives ONLY in defined-types.generated.ts', () => {
    expect(definedSrc).toContain('export const TYPE_REGISTRY: TypeRegistry =');
    expect(accountsSrc).not.toContain('= buildTypeRegistry(');
    expect(instructionsSrc).not.toContain('= buildTypeRegistry(');
  });

  it('WIRE_ENTRY_FIELDS const-declaration lives ONLY in defined-types.generated.ts', () => {
    expect(definedSrc).toContain('export const WIRE_ENTRY_FIELDS:');
    expect(accountsSrc).not.toContain('export const WIRE_ENTRY_FIELDS:');
    expect(instructionsSrc).not.toContain('export const WIRE_ENTRY_FIELDS:');
  });

  it('IDL_ENTRY_FIELDS const-declaration lives ONLY in defined-types.generated.ts', () => {
    expect(definedSrc).toContain('export const IDL_ENTRY_FIELDS:');
    expect(accountsSrc).not.toContain('const IDL_ENTRY_FIELDS:');
    expect(instructionsSrc).not.toContain('const IDL_ENTRY_FIELDS:');
  });

  it('accounts and instructions both import from ./defined-types.generated.js', () => {
    expect(accountsSrc).toContain("from './defined-types.generated.js';");
    expect(instructionsSrc).toContain("from './defined-types.generated.js';");
  });

  it('accounts.generated.ts still emits its own per-account WIRE/IDL fields (these are NOT defined types)', () => {
    // Vault is the account; per-account WIRE_VAULT_FIELDS / IDL_VAULT_FIELDS
    // remain inline in accounts.generated.ts (they are not a `defined` type).
    expect(accountsSrc).toContain('WIRE_VAULT_FIELDS');
    expect(accountsSrc).toContain('IDL_VAULT_FIELDS');
  });
});

describe('determinism — generateTypes is byte-identical across runs', () => {
  it('mixed.idl.json: all 4 generated files identical on second run', () => {
    const idl1 = parseIdlJson(fixture('mixed.idl.json'));
    const idl2 = parseIdlJson(fixture('mixed.idl.json'));
    const a = generateTypes(idl1);
    const b = generateTypes(idl2);
    expect(b.accounts).toBe(a.accounts);
    expect(b.instructions).toBe(a.instructions);
    expect(b.errors).toBe(a.errors);
    expect(b.definedTypes).toBe(a.definedTypes);
  });

  it('minimal.idl.json: definedTypes file is byte-identical across runs', () => {
    const idl1 = parseIdlJson(fixture('minimal.idl.json'));
    const idl2 = parseIdlJson(fixture('minimal.idl.json'));
    expect(emitDefinedTypesSource(idl2)).toBe(emitDefinedTypesSource(idl1));
  });

  it('import block in accounts.generated.ts is alphabetically sorted', () => {
    const idl = parseIdlJson(fixture('mixed.idl.json'));
    const src = emitAccountsSource(idl);
    // Extract ONLY the defined-types import block (not the runtime import,
    // which is hand-ordered for grouping by category not alphabet).
    // The block ends at `} from './defined-types.generated.js';`.
    const definedTypesImportRegex =
      /import \{([^}]*)\} from '\.\/defined-types\.generated\.js';/;
    const m = src.match(definedTypesImportRegex);
    expect(m).not.toBeNull();
    const lines = m![1]
      .split('\n')
      .map(l => l.trim().replace(/,$/, ''))
      .filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const sorted = [...lines].sort();
    expect(lines).toEqual(sorted);
  });
});

describe('generateTypes — public API exposes definedTypes', () => {
  it('returns definedTypes string and filename', () => {
    const idl = parseIdlJson(fixture('mixed.idl.json'));
    const out = generateTypes(idl);
    expect(typeof out.definedTypes).toBe('string');
    expect(out.definedTypes.length).toBeGreaterThan(0);
    expect(out.filenames.definedTypes).toBe('defined-types.generated.ts');
  });

  it('definedTypes file contains the AUTO-GENERATED banner', () => {
    const idl = parseIdlJson(fixture('mixed.idl.json'));
    const out = generateTypes(idl);
    expect(out.definedTypes).toContain('AUTO-GENERATED');
  });
});
