/**
 * Emit typed instruction args/accounts interfaces + discriminators + encode helpers.
 *
 * For each instruction in the IDL we emit:
 *   - `<NAME>_DISCRIMINATOR` constant (8-byte Uint8Array).
 *   - `interface <Name>Args` for the camelCase TS arg shape (omitted if no args).
 *   - `interface <Name>Accounts` listing PublicKey-typed account slots.
 *   - `encode<Name>Args(args): Buffer` — wraps `serializeArgs`.
 *   - `WIRE_<NAME>_ARG_FIELDS` snake/camel map.
 *
 * Phase 3.5 C.2 — defined struct/enum interfaces, their WIRE/IDL field
 * constants, and the program-wide TYPE_REGISTRY are no longer emitted
 * here. They live in `defined-types.generated.ts` (single source of
 * truth per program) and are imported below.
 */
import type { IdlInstruction, IdlType, IdlTypeDef } from '../types';
import { camelField, pascalType, safeConstName } from './naming';
import { mapIdlType, UnsupportedTypeError } from './type-mapper';
import { instructionDiscriminator } from '../discriminator';
import type { PubkeyOverrides } from './pubkey-detection';
import type { NormalizedIdl } from './parser';
import {
  fieldListLiteral,
  wireMapLiteral,
  nestedMapsLiteral,
} from './emit-defined';

export interface EmitInstructionsOptions {
  overrides?: PubkeyOverrides;
}

function toUint8ArrayLiteral(buf: Buffer): string {
  const items = Array.from(buf).map(b => `0x${b.toString(16).padStart(2, '0')}`);
  return `new Uint8Array([${items.join(', ')}])`;
}

/**
 * Walk instructions and collect every `defined` type referenced from arg
 * fields. Mirrors `collectDefinedFromAll` ordering for deterministic
 * import blocks.
 */
function collectDefinedFromInstructions(
  ixs: IdlInstruction[],
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
  for (const ix of ixs) {
    for (const arg of ix.args) visit(arg.type);
  }
  return order;
}

/**
 * Build the `import { ... } from './defined-types.generated.js';` block.
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

/** Emit `instructions.generated.ts` source. */
export function emitInstructionsSource(idl: NormalizedIdl, options: EmitInstructionsOptions = {}): string {
  const lines: string[] = [];

  // Explicit Buffer import — required for browser bundlers (Vite/Rollup) which
  // do NOT auto-polyfill the global `Buffer`. Generated `encode*Args` helpers
  // use `Buffer.from` / `Buffer.concat`, so consumers building for the browser
  // need this `import { Buffer } from 'buffer'` to resolve to a polyfill.
  lines.push(`import { Buffer } from 'buffer';`, '');

  lines.push(
    `import {`,
    `  PublicKey,`,
    `  type Bytes32,`,
    `  type WireFieldMap,`,
    `  type IdlField,`,
    `  serializeArgs,`,
    `  instructionDiscriminator,`,
    `  remapTsToWire,`,
    `} from '@arlex/client/codegen-runtime';`,
    '',
  );

  // Pull defined types + TYPE_REGISTRY from the per-program shared file.
  const defined = collectDefinedFromInstructions(idl.instructions, idl.definedRegistry);
  const hasTypeRegistry = idl.types.length > 0 || idl.accounts.length > 0;
  const importBlock = buildDefinedImportBlock(defined, hasTypeRegistry);
  if (importBlock) {
    lines.push(importBlock, '');
  }

  for (const ix of idl.instructions) {
    const tsName = pascalType(ix.name);
    // Validated identifier stem — `safeConstName` throws if `ix.name` contains
    // any character that could break out of an identifier / comment context.
    const constStem = safeConstName(ix.name);

    lines.push(`// ============================================================`);
    lines.push(`// Instruction: ${ix.name}`);
    lines.push(`// ============================================================`);
    lines.push('');

    const disc = instructionDiscriminator(ix.name);
    lines.push(`export const ${constStem}_DISCRIMINATOR: Uint8Array = ${toUint8ArrayLiteral(disc)};`);
    lines.push('');

    // Accounts interface
    if (ix.accounts.length > 0) {
      lines.push(`export interface ${tsName}Accounts {`);
      for (const a of ix.accounts) {
        const fld = camelField(a.name);
        lines.push(`  /** ${a.isSigner ? 'signer' : 'readonly'}${a.isMut ? ', writable' : ''} */`);
        lines.push(`  ${fld}: PublicKey;`);
      }
      lines.push(`}`);
      lines.push('');
    }

    // Args interface (only if any args)
    if (ix.args.length > 0) {
      lines.push(`export interface ${tsName}Args {`);
      for (const f of ix.args) {
        const tsField = camelField(f.name);
        let tsType: string;
        try {
          tsType = mapIdlType(f.type, {
            registry: idl.definedRegistry,
            overrides: options.overrides,
            outerTypeName: ix.name,
            fieldName: f.name,
          });
        } catch (e) {
          if (e instanceof UnsupportedTypeError) {
            throw new UnsupportedTypeError(`instruction '${ix.name}' arg '${f.name}': ${e.message}`);
          }
          throw e;
        }
        lines.push(`  ${tsField}: ${tsType};`);
      }
      lines.push(`}`);
      lines.push('');

      lines.push(`const IDL_${constStem}_ARG_FIELDS: IdlField[] = ${fieldListLiteral(ix.args)};`);
      lines.push('');
      lines.push(`export const WIRE_${constStem}_ARG_FIELDS: WireFieldMap = ${wireMapLiteral(ix.args)};`);
      lines.push('');

      const { nested, arrays } = nestedMapsLiteral(ix.args, idl.definedRegistry);
      lines.push(`/**`);
      lines.push(` * Encode arguments for the \`${ix.name}\` instruction.`);
      lines.push(` * Returns a Buffer with discriminator + serialized args.`);
      lines.push(` */`);
      lines.push(`export function encode${tsName}Args(args: ${tsName}Args): Buffer {`);
      lines.push(`  const wire = remapTsToWire(args as unknown as Record<string, unknown>, WIRE_${constStem}_ARG_FIELDS, {`);
      lines.push(`    nestedMaps: ${nested},`);
      lines.push(`    arrayMaps: ${arrays},`);
      lines.push(`  });`);
      lines.push(`  const argBuf = serializeArgs(IDL_${constStem}_ARG_FIELDS, wire, TYPE_REGISTRY);`);
      lines.push(`  return Buffer.concat([Buffer.from(${constStem}_DISCRIMINATOR), argBuf]);`);
      lines.push(`}`);
      lines.push('');
    } else {
      lines.push(`/** Encode (no args) for the \`${ix.name}\` instruction — discriminator only. */`);
      lines.push(`export function encode${tsName}Args(): Buffer {`);
      lines.push(`  return Buffer.from(${constStem}_DISCRIMINATOR);`);
      lines.push(`}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
