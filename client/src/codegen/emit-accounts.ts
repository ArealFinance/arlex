/**
 * Emit typed account interfaces + discriminators + parse functions.
 *
 * For each account in the IDL we emit:
 *   - An `interface` describing the camelCase TS shape.
 *   - A `<NAME>_DISCRIMINATOR` constant (Uint8Array of 8 bytes).
 *   - A `parse<Name>(data: Buffer | Uint8Array): <Name>` function.
 *   - A `WIRE_<NAME>_FIELDS` map (snake_case -> camelCase).
 *
 * Phase 3.5 C.2 — defined struct/enum interfaces, their WIRE/IDL field
 * constants, and the program-wide TYPE_REGISTRY are no longer emitted
 * here. They live in `defined-types.generated.ts` (single source of
 * truth per program) and are imported below.
 */
import type { IdlAccountDef, IdlField, IdlType, IdlTypeDef } from '../types';
import { camelField, pascalType, safeConstName } from './naming';
import { mapIdlType, UnsupportedTypeError } from './type-mapper';
import { accountDiscriminator } from '../discriminator';
import type { PubkeyOverrides } from './pubkey-detection';
import type { NormalizedIdl } from './parser';
import {
  fieldListLiteral,
  wireMapLiteral,
  nestedMapsLiteral,
} from './emit-defined';

export interface EmitAccountsOptions {
  overrides?: PubkeyOverrides;
}

/** Format a Uint8Array literal for embedding in TS source. */
function toUint8ArrayLiteral(buf: Buffer): string {
  const items = Array.from(buf).map(b => `0x${b.toString(16).padStart(2, '0')}`);
  return `new Uint8Array([${items.join(', ')}])`;
}

/**
 * Walk accounts and collect every `defined` type (struct or enum) that
 * is transitively referenced from an account field. The returned list
 * is in declaration order matching `collectDefinedFromAll` in
 * `emit-defined-types.ts` so the import block stays stable across runs.
 */
function collectDefinedFromAccounts(
  accounts: IdlAccountDef[],
  registry: Map<string, IdlTypeDef>,
): IdlTypeDef[] {
  const seen = new Set<string>();
  const order: IdlTypeDef[] = [];
  const visit = (type: IdlType) => {
    if (typeof type === 'string') return;
    if ('vec' in type) return visit(type.vec);
    if ('option' in type) return visit(type.option);
    if ('array' in type) return visit(type.array[0]);
    if ('defined' in type) {
      if (seen.has(type.defined)) return;
      const def = registry.get(type.defined);
      if (!def) return;
      if (def.type.kind === 'struct' && def.type.fields) {
        for (const f of def.type.fields) visit(f.type);
      }
      seen.add(type.defined);
      order.push(def);
    }
  };
  for (const acc of accounts) {
    for (const f of acc.type.fields) visit(f.type);
  }
  return order;
}

/**
 * Build the `import { ... } from './defined-types.generated.js';` block
 * for everything this emitter needs from the per-program shared file.
 *
 * For each defined type we import:
 *   - the PascalCase name (interface for struct, type alias for enum)
 *   - for structs only: WIRE_<STEM>_FIELDS and IDL_<STEM>_FIELDS
 *
 * Plus the always-needed TYPE_REGISTRY constant.
 *
 * Imports are sorted alphabetically inside the brace block for
 * deterministic output.
 */
function buildDefinedImportBlock(defined: IdlTypeDef[], hasTypeRegistry: boolean): string {
  const idents = new Set<string>();
  if (hasTypeRegistry) idents.add('TYPE_REGISTRY');
  for (const def of defined) {
    idents.add(pascalType(def.name));
    if (def.type.kind === 'struct') {
      const stem = safeConstName(def.name);
      idents.add(`WIRE_${stem}_FIELDS`);
      idents.add(`IDL_${stem}_FIELDS`);
    }
  }
  if (idents.size === 0) return '';
  const sorted = Array.from(idents).sort();
  const lines = [`import {`];
  for (const id of sorted) lines.push(`  ${id},`);
  lines.push(`} from './defined-types.generated.js';`);
  return lines.join('\n');
}

/**
 * Emit `accounts.generated.ts` source.
 */
export function emitAccountsSource(idl: NormalizedIdl, options: EmitAccountsOptions = {}): string {
  const lines: string[] = [];

  // Explicit Buffer import — required for browser bundlers (Vite/Rollup) which
  // do NOT auto-polyfill the global `Buffer`. Generated parsers below use
  // `Buffer.isBuffer` / `Buffer.from`, so consumers building for the browser
  // need this `import { Buffer } from 'buffer'` to resolve to a polyfill.
  lines.push(`import { Buffer } from 'buffer';`, '');

  lines.push(
    `import {`,
    `  PublicKey,`,
    `  type Bytes32,`,
    `  type WireFieldMap,`,
    `  type IdlField,`,
    `  deserializeAccount,`,
    `  accountDiscriminator,`,
    `  parseDiscriminator,`,
    `  remapWireToTs,`,
    `} from '@arlex/client/codegen-runtime';`,
    '',
  );

  // Pull defined types + TYPE_REGISTRY from the per-program shared file.
  const defined = collectDefinedFromAccounts(idl.accounts, idl.definedRegistry);
  const hasTypeRegistry = idl.types.length > 0 || idl.accounts.length > 0;
  const importBlock = buildDefinedImportBlock(defined, hasTypeRegistry);
  if (importBlock) {
    lines.push(importBlock, '');
  }

  // Accounts.
  for (const acc of idl.accounts) {
    const tsName = pascalType(acc.name);

    lines.push(`// ============================================================`);
    lines.push(`// Account: ${acc.name}`);
    lines.push(`// ============================================================`);
    lines.push('');
    lines.push(`export interface ${tsName} {`);
    for (const f of acc.type.fields) {
      const tsField = camelField(f.name);
      let tsType: string;
      try {
        tsType = mapIdlType(f.type, {
          registry: idl.definedRegistry,
          overrides: options.overrides,
          outerTypeName: acc.name,
          fieldName: f.name,
        });
      } catch (e) {
        if (e instanceof UnsupportedTypeError) {
          throw new UnsupportedTypeError(`account '${acc.name}' field '${f.name}': ${e.message}`);
        }
        throw e;
      }
      lines.push(`  ${tsField}: ${tsType};`);
    }
    lines.push(`}`);
    lines.push('');

    const disc = accountDiscriminator(acc.name);
    // Validated identifier stem — `safeConstName` throws if `acc.name` contains
    // any character that could break out of the constant-name context.
    const constStem = safeConstName(acc.name);
    lines.push(`export const ${constStem}_DISCRIMINATOR: Uint8Array = ${toUint8ArrayLiteral(disc)};`);
    lines.push('');

    lines.push(`export const WIRE_${constStem}_FIELDS: WireFieldMap = ${wireMapLiteral(acc.type.fields)};`);
    lines.push('');

    lines.push(`const IDL_${constStem}_FIELDS: IdlField[] = ${fieldListLiteral(acc.type.fields)};`);
    lines.push('');

    const { nested, arrays } = nestedMapsLiteral(acc.type.fields, idl.definedRegistry);
    lines.push(`/**`);
    lines.push(` * Parse a ${tsName} account from raw bytes (including 8-byte discriminator).`);
    lines.push(` * Throws if the discriminator does not match.`);
    lines.push(` */`);
    lines.push(`export function parse${tsName}(data: Buffer | Uint8Array): ${tsName} {`);
    lines.push(`  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);`);
    lines.push(`  parseDiscriminator(buf, ${constStem}_DISCRIMINATOR, ${JSON.stringify(tsName)});`);
    lines.push(`  const raw = deserializeAccount(IDL_${constStem}_FIELDS, buf, TYPE_REGISTRY);`);
    lines.push(`  return remapWireToTs(raw, WIRE_${constStem}_FIELDS, {`);
    lines.push(`    nestedMaps: ${nested},`);
    lines.push(`    arrayMaps: ${arrays},`);
    lines.push(`  }) as unknown as ${tsName};`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}
