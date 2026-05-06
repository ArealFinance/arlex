/**
 * Emit typed account interfaces + discriminators + parse functions.
 *
 * For each account in the IDL we emit:
 *   - An `interface` describing the camelCase TS shape.
 *   - A `<NAME>_DISCRIMINATOR` constant (Uint8Array of 8 bytes).
 *   - A `parse<Name>(data: Buffer | Uint8Array): <Name>` function.
 *   - A `WIRE_<NAME>_FIELDS` map (snake_case -> camelCase).
 *
 * Also emits, for each `defined` struct type referenced from accounts:
 *   - An `interface` for the struct.
 *   - A `WIRE_<NAME>_FIELDS` map.
 *   - An IDL field-list constant for downstream encode/decode.
 */
import type { IdlAccountDef, IdlField, IdlType, IdlTypeDef } from '../types';
import { camelField, pascalType, safeConstName } from './naming';
import { mapIdlType, mapEnumVariants, UnsupportedTypeError } from './type-mapper';
import { accountDiscriminator } from '../discriminator';
import type { PubkeyOverrides } from './pubkey-detection';
import type { NormalizedIdl } from './parser';

export interface EmitAccountsOptions {
  overrides?: PubkeyOverrides;
}

interface EmitContext {
  registry: Map<string, IdlTypeDef>;
  overrides?: PubkeyOverrides;
  /** Defined-type names already emitted (to dedupe across runs). */
  emittedDefined: Set<string>;
}

/** Format a Uint8Array literal for embedding in TS source. */
function toUint8ArrayLiteral(buf: Buffer): string {
  const items = Array.from(buf).map(b => `0x${b.toString(16).padStart(2, '0')}`);
  return `new Uint8Array([${items.join(', ')}])`;
}

/** Emit a JSON literal for an IDL field-list (used as runtime input). */
function fieldListLiteral(fields: IdlField[]): string {
  // JSON.stringify with stable ordering — IdlField shape is small + flat.
  return JSON.stringify(fields, null, 2);
}

function fieldsContainDefinedStruct(fields: IdlField[], registry: Map<string, IdlTypeDef>): string[] {
  const names: string[] = [];
  const visit = (type: IdlType) => {
    if (typeof type === 'string') return;
    if ('vec' in type) return visit(type.vec);
    if ('option' in type) return visit(type.option);
    if ('array' in type) return visit(type.array[0]);
    if ('defined' in type) {
      const def = registry.get(type.defined);
      if (def && def.type.kind === 'struct') names.push(type.defined);
    }
  };
  for (const f of fields) visit(f.type);
  return names;
}

/** Build the wire->TS map literal: `{ wire_key: 'tsKey', ... }` as TS source. */
function wireMapLiteral(fields: IdlField[]): string {
  const entries = fields.map(f => `  ${JSON.stringify(f.name)}: ${JSON.stringify(camelField(f.name))},`);
  return `{\n${entries.join('\n')}\n}`;
}

/** Build the nestedMaps literal for `defined` struct fields inside a parent type. */
function nestedMapsLiteral(fields: IdlField[], registry: Map<string, IdlTypeDef>): { nested: string; arrays: string } {
  const nestedEntries: string[] = [];
  const arrayEntries: string[] = [];
  for (const f of fields) {
    const tsField = camelField(f.name);
    let inner: IdlType | null = null;
    let isArray = false;
    if (typeof f.type === 'object') {
      if ('defined' in f.type) inner = f.type;
      else if ('vec' in f.type && typeof f.type.vec === 'object' && 'defined' in f.type.vec) {
        inner = f.type.vec;
        isArray = true;
      } else if ('array' in f.type && typeof f.type.array[0] === 'object' && 'defined' in f.type.array[0]) {
        inner = f.type.array[0];
        isArray = true;
      } else if ('option' in f.type && typeof f.type.option === 'object' && 'defined' in f.type.option) {
        inner = f.type.option;
      }
    }
    if (inner && 'defined' in inner) {
      const def = registry.get(inner.defined);
      if (def && def.type.kind === 'struct') {
        const mapName = `WIRE_${safeConstName(def.name)}_FIELDS`;
        if (isArray) arrayEntries.push(`  ${JSON.stringify(tsField)}: ${mapName},`);
        else nestedEntries.push(`  ${JSON.stringify(tsField)}: ${mapName},`);
      }
    }
  }
  const nested = nestedEntries.length === 0 ? '{}' : `{\n${nestedEntries.join('\n')}\n}`;
  const arrays = arrayEntries.length === 0 ? '{}' : `{\n${arrayEntries.join('\n')}\n}`;
  return { nested, arrays };
}

function emitDefinedStruct(name: string, fields: IdlField[], ctx: EmitContext, lines: string[]): void {
  if (ctx.emittedDefined.has(name)) return;
  // Recurse first into nested defined types so they appear before consumers.
  for (const inner of fieldsContainDefinedStruct(fields, ctx.registry)) {
    if (ctx.emittedDefined.has(inner)) continue;
    const def = ctx.registry.get(inner);
    if (def && def.type.kind === 'struct' && def.type.fields) {
      emitDefinedStruct(inner, def.type.fields, ctx, lines);
    }
  }
  ctx.emittedDefined.add(name);
  const tsName = pascalType(name);
  lines.push(`/** Defined struct from IDL: ${name} */`);
  lines.push(`export interface ${tsName} {`);
  for (const f of fields) {
    const tsField = camelField(f.name);
    const tsType = mapIdlType(f.type, {
      registry: ctx.registry,
      overrides: ctx.overrides,
      outerTypeName: name,
      fieldName: f.name,
    });
    lines.push(`  ${tsField}: ${tsType};`);
  }
  lines.push(`}`);
  lines.push('');
  const constStem = safeConstName(name);
  lines.push(`export const WIRE_${constStem}_FIELDS: WireFieldMap = ${wireMapLiteral(fields)};`);
  lines.push('');
  lines.push(`/** Raw IDL field shape for ${name} — used by the runtime serializer. */`);
  lines.push(`export const IDL_${constStem}_FIELDS: IdlField[] = ${fieldListLiteral(fields)};`);
  lines.push('');
}

function emitDefinedEnum(name: string, def: IdlTypeDef, ctx: EmitContext, lines: string[]): void {
  if (ctx.emittedDefined.has(name)) return;
  ctx.emittedDefined.add(name);
  const tsName = pascalType(name);
  const variants = mapEnumVariants(def);
  lines.push(`/** Defined enum (tag-only) from IDL: ${name} */`);
  lines.push(`export type ${tsName} = ${variants};`);
  lines.push('');
}

function collectDefinedFromAccounts(accounts: IdlAccountDef[], registry: Map<string, IdlTypeDef>): IdlTypeDef[] {
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
 * Emit `accounts.generated.ts` source.
 */
export function emitAccountsSource(idl: NormalizedIdl, options: EmitAccountsOptions = {}): string {
  const ctx: EmitContext = {
    registry: idl.definedRegistry,
    overrides: options.overrides,
    emittedDefined: new Set<string>(),
  };
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
    `  type TypeRegistry,`,
    `  buildTypeRegistry,`,
    `  deserializeAccount,`,
    `  accountDiscriminator,`,
    `  parseDiscriminator,`,
    `  remapWireToTs,`,
    `} from '@arlex/client/codegen-runtime';`,
    '',
  );

  // Defined types come first.
  const defined = collectDefinedFromAccounts(idl.accounts, idl.definedRegistry);
  for (const def of defined) {
    if (def.type.kind === 'enum') {
      emitDefinedEnum(def.name, def, ctx, lines);
    } else if (def.type.kind === 'struct' && def.type.fields) {
      emitDefinedStruct(def.name, def.type.fields, ctx, lines);
    }
  }

  // Shared TypeRegistry constant — built once, reused by all parsers.
  if (idl.types.length > 0 || idl.accounts.length > 0) {
    const typesLiteral = idl.types.length
      ? JSON.stringify(idl.types)
      : '[]';
    const accountsLiteral = idl.accounts.length
      ? JSON.stringify(idl.accounts.map(a => ({ name: a.name, type: a.type })))
      : '[]';
    lines.push(`/** Type registry shared across all account parsers in this module. */`);
    lines.push(`const TYPE_REGISTRY: TypeRegistry = buildTypeRegistry(${typesLiteral} as any, ${accountsLiteral} as any);`);
    lines.push('');
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
          registry: ctx.registry,
          overrides: ctx.overrides,
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
