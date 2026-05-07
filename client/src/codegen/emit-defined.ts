/**
 * Shared helpers for emitting `defined` IDL types (structs and enums).
 *
 * Phase 3.5 C.2 — these helpers used to be duplicated inside
 * `emit-accounts.ts` and `emit-instructions.ts`. They now live here so a
 * single per-program `defined-types.generated.ts` file can be produced and
 * the accounts/instructions emitters can import from it instead of
 * inlining each interface twice.
 *
 * The functions in this module are pure: they take the raw IDL pieces and
 * push string lines to a caller-owned buffer. No file I/O, no logging.
 */
import type { IdlField, IdlType, IdlTypeDef } from '../types';
import { camelField, pascalType, safeConstName } from './naming';
import { mapIdlType, mapEnumVariants } from './type-mapper';
import type { PubkeyOverrides } from './pubkey-detection';

export interface DefinedEmitContext {
  registry: Map<string, IdlTypeDef>;
  overrides?: PubkeyOverrides;
  /** Defined-type names already emitted (caller-owned, for dedupe across calls). */
  emittedDefined: Set<string>;
}

/** JSON literal for an IDL field-list (used as runtime input). */
export function fieldListLiteral(fields: IdlField[]): string {
  return JSON.stringify(fields, null, 2);
}

/** Build the wire->TS map literal: `{ wire_key: 'tsKey', ... }` as TS source. */
export function wireMapLiteral(fields: IdlField[]): string {
  if (fields.length === 0) return '{}';
  const entries = fields.map(f => `  ${JSON.stringify(f.name)}: ${JSON.stringify(camelField(f.name))},`);
  return `{\n${entries.join('\n')}\n}`;
}

/** Build nestedMaps + arrayMaps literal for `defined` struct fields inside a parent type. */
export function nestedMapsLiteral(
  fields: IdlField[],
  registry: Map<string, IdlTypeDef>,
): { nested: string; arrays: string } {
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

/** Walk a type and return the names of `defined` STRUCT types it directly references. */
export function fieldsContainDefinedStruct(
  fields: IdlField[],
  registry: Map<string, IdlTypeDef>,
): string[] {
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

/**
 * Emit the lines for one defined struct (interface + WIRE_*_FIELDS + IDL_*_FIELDS).
 * Recursively emits nested struct dependencies first so they appear before consumers.
 *
 * Mutates `lines` and `ctx.emittedDefined`. No-op if already emitted.
 *
 * Note: the emitted `IDL_<NAME>_FIELDS` is `export const` here (in
 * defined-types.generated.ts it must be exported so accounts/instructions
 * can import it). The original inline emitter in emit-accounts used an
 * un-exported `const` for account-only `IDL_<NAME>_FIELDS`; that is kept
 * separate and is NOT this function's concern.
 */
export function emitDefinedStructLines(
  name: string,
  fields: IdlField[],
  ctx: DefinedEmitContext,
  lines: string[],
): void {
  if (ctx.emittedDefined.has(name)) return;
  // Recurse into nested defined structs first so they appear before consumers.
  for (const inner of fieldsContainDefinedStruct(fields, ctx.registry)) {
    if (ctx.emittedDefined.has(inner)) continue;
    const def = ctx.registry.get(inner);
    if (def && def.type.kind === 'struct' && def.type.fields) {
      emitDefinedStructLines(inner, def.type.fields, ctx, lines);
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

/** Emit the lines for one defined enum (string-literal union type). */
export function emitDefinedEnumLines(
  name: string,
  def: IdlTypeDef,
  ctx: DefinedEmitContext,
  lines: string[],
): void {
  if (ctx.emittedDefined.has(name)) return;
  ctx.emittedDefined.add(name);
  const tsName = pascalType(name);
  const variants = mapEnumVariants(def);
  lines.push(`/** Defined enum (tag-only) from IDL: ${name} */`);
  lines.push(`export type ${tsName} = ${variants};`);
  lines.push('');
}
