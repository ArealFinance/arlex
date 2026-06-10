/**
 * Emit `defined-types.generated.ts` — the per-program file containing
 * every shared `defined` IDL type plus the program-wide TYPE_REGISTRY.
 *
 * Phase 3.5 C.2 — previously, every `defined` struct/enum was emitted
 * twice (once in `accounts.generated.ts` and again in
 * `instructions.generated.ts`), and `TYPE_REGISTRY` (~3 KB JSON literal)
 * was duplicated as well. This file consolidates them into a single
 * source-of-truth that the other two emitters import from.
 *
 * Collection order is deterministic:
 *   1. Walk `idl.accounts` in declaration order — every `defined` struct/enum
 *      transitively referenced from an account field is collected.
 *   2. Then walk `idl.instructions` in declaration order — same for arg types.
 *
 * Names already collected in step 1 are skipped in step 2 (no duplicates).
 */
import type { IdlAccountDef, IdlInstruction, IdlType, IdlTypeDef } from '../types';
import {
  emitDefinedStructLines,
  emitDefinedEnumLines,
  type DefinedEmitContext,
} from './emit-defined';
import type { PubkeyOverrides } from './pubkey-detection';
import type { NormalizedIdl } from './parser';

export interface EmitDefinedTypesOptions {
  overrides?: PubkeyOverrides;
}

/**
 * Collect every IdlTypeDef transitively referenced from accounts and
 * instructions, in stable declaration order. Used both to drive emission
 * and to compute the `TYPE_REGISTRY` payload.
 */
function collectDefinedFromAll(
  accounts: IdlAccountDef[],
  instructions: IdlInstruction[],
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
      // Recurse into struct fields BEFORE marking seen, so nested
      // defined types are appended to `order` first (dependency order).
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
  for (const ix of instructions) {
    for (const arg of ix.args) visit(arg.type);
  }
  return order;
}

/**
 * Emit the source for `defined-types.generated.ts` (without banner — the
 * caller in `index.ts` prepends the shared banner).
 */
export function emitDefinedTypesSource(
  idl: NormalizedIdl,
  options: EmitDefinedTypesOptions = {},
): string {
  const ctx: DefinedEmitContext = {
    registry: idl.definedRegistry,
    overrides: options.overrides,
    emittedDefined: new Set<string>(),
  };
  const lines: string[] = [];

  // Runtime imports.
  //
  // PublicKey + Bytes32 are required because defined struct interfaces emit
  // those types when an IDL field is a 32-byte array classified as
  // pubkey/bytes32 by `mapIdlType` (see type-mapper.ts).
  //
  // WireFieldMap / IdlField / TypeRegistry / buildTypeRegistry are needed
  // for the WIRE_*_FIELDS / IDL_*_FIELDS constants and TYPE_REGISTRY.
  lines.push(
    `import {`,
    `  PublicKey,`,
    `  type Bytes32,`,
    `  type WireFieldMap,`,
    `  type IdlField,`,
    `  type TypeRegistry,`,
    `  buildTypeRegistry,`,
    `} from '@arlex/client/codegen-runtime';`,
    '',
  );

  // Emit defined types in dependency order across both accounts + instructions.
  const defined = collectDefinedFromAll(idl.accounts, idl.instructions, idl.definedRegistry);
  for (const def of defined) {
    if (def.type.kind === 'enum') {
      emitDefinedEnumLines(def.name, def, ctx, lines);
    } else if (def.type.kind === 'struct' && def.type.fields) {
      emitDefinedStructLines(def.name, def.type.fields, ctx, lines);
    }
  }

  // Program-wide TYPE_REGISTRY — built once, exported, reused by accounts
  // (deserialize) and instructions (serialize) emitters.
  if (idl.types.length > 0 || idl.accounts.length > 0) {
    const typesLiteral = idl.types.length ? JSON.stringify(idl.types) : '[]';
    const accountsLiteral = idl.accounts.length
      ? JSON.stringify(idl.accounts.map(a => ({ name: a.name, type: a.type })))
      : '[]';
    lines.push(`/** Type registry shared across all parsers and encoders in this program. */`);
    lines.push(`export const TYPE_REGISTRY: TypeRegistry = buildTypeRegistry(${typesLiteral} as any, ${accountsLiteral} as any);`);
    lines.push('');
  } else {
    // Empty-IDL edge case — still export TYPE_REGISTRY for a uniform import shape.
    lines.push(`/** Type registry (empty IDL — no accounts or named types). */`);
    lines.push(`export const TYPE_REGISTRY: TypeRegistry = buildTypeRegistry([] as any, [] as any);`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Compute the set of defined-type identifier stems that consumers
 * (accounts.generated.ts, instructions.generated.ts) need to import from
 * the per-program defined-types file. Returns names in declaration order.
 *
 * For each entry, the consumer should import:
 *   - PascalCase type name (struct interface OR enum union type)
 *   - For structs: WIRE_<STEM>_FIELDS, IDL_<STEM>_FIELDS
 *
 * Exported separately so the consumer emitters can build their import
 * blocks without re-walking the IDL themselves (single source of truth).
 */
export function collectDefinedTypeNames(idl: NormalizedIdl): IdlTypeDef[] {
  return collectDefinedFromAll(idl.accounts, idl.instructions, idl.definedRegistry);
}
