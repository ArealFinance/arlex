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
 * Defined struct types referenced from instruction args are emitted (in
 * dependency order) at the top of the file with their interface, wire map,
 * and IDL field-list constants.
 */
import type { IdlField, IdlInstruction, IdlType, IdlTypeDef } from '../types';
import { camelField, pascalType, safeConstName } from './naming';
import { mapIdlType, mapEnumVariants, UnsupportedTypeError } from './type-mapper';
import { instructionDiscriminator } from '../discriminator';
import type { PubkeyOverrides } from './pubkey-detection';
import type { NormalizedIdl } from './parser';

export interface EmitInstructionsOptions {
  overrides?: PubkeyOverrides;
}

interface EmitContext {
  registry: Map<string, IdlTypeDef>;
  overrides?: PubkeyOverrides;
  emittedDefined: Set<string>;
}

function toUint8ArrayLiteral(buf: Buffer): string {
  const items = Array.from(buf).map(b => `0x${b.toString(16).padStart(2, '0')}`);
  return `new Uint8Array([${items.join(', ')}])`;
}

function fieldListLiteral(fields: IdlField[]): string {
  return JSON.stringify(fields, null, 2);
}

function wireMapLiteral(fields: IdlField[]): string {
  if (fields.length === 0) return '{}';
  const entries = fields.map(f => `  ${JSON.stringify(f.name)}: ${JSON.stringify(camelField(f.name))},`);
  return `{\n${entries.join('\n')}\n}`;
}

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

function emitDefinedStruct(name: string, fields: IdlField[], ctx: EmitContext, lines: string[]): void {
  if (ctx.emittedDefined.has(name)) return;
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

function collectDefinedFromInstructions(ixs: IdlInstruction[], registry: Map<string, IdlTypeDef>): IdlTypeDef[] {
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

/** Emit `instructions.generated.ts` source. */
export function emitInstructionsSource(idl: NormalizedIdl, options: EmitInstructionsOptions = {}): string {
  const ctx: EmitContext = {
    registry: idl.definedRegistry,
    overrides: options.overrides,
    emittedDefined: new Set<string>(),
  };
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
    `  type TypeRegistry,`,
    `  buildTypeRegistry,`,
    `  serializeArgs,`,
    `  instructionDiscriminator,`,
    `  remapTsToWire,`,
    `} from '@arlex/client/codegen-runtime';`,
    '',
  );

  const defined = collectDefinedFromInstructions(idl.instructions, idl.definedRegistry);
  for (const def of defined) {
    if (def.type.kind === 'enum') {
      emitDefinedEnum(def.name, def, ctx, lines);
    } else if (def.type.kind === 'struct' && def.type.fields) {
      emitDefinedStruct(def.name, def.type.fields, ctx, lines);
    }
  }

  if (idl.types.length > 0 || idl.accounts.length > 0) {
    const typesLiteral = idl.types.length
      ? JSON.stringify(idl.types)
      : '[]';
    const accountsLiteral = idl.accounts.length
      ? JSON.stringify(idl.accounts.map(a => ({ name: a.name, type: a.type })))
      : '[]';
    lines.push(`/** Type registry shared across all instruction encoders in this module. */`);
    lines.push(`const TYPE_REGISTRY: TypeRegistry = buildTypeRegistry(${typesLiteral} as any, ${accountsLiteral} as any);`);
    lines.push('');
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
            registry: ctx.registry,
            overrides: ctx.overrides,
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
