/**
 * Map IDL types to TypeScript type strings.
 *
 * The mapper is pure: it does not import the runtime, only emits text.
 * It throws on enum-with-data (intentionally out of scope for Phase 2).
 */
import type { IdlType, IdlTypeDef } from '../types';
import { classifyBytesField, lookupOverride, type PubkeyOverrides } from './pubkey-detection';
import { pascalType, sanitizeIdent } from './naming';

export class UnsupportedTypeError extends Error {
  constructor(message: string) {
    super(`Unsupported type: ${message}`);
    this.name = 'UnsupportedTypeError';
  }
}

export interface MapTypeContext {
  /** Map of defined-type-name -> IdlTypeDef. Used for enum-with-data detection. */
  registry: Map<string, IdlTypeDef>;
  /** Optional per-type pubkey overrides. */
  overrides?: PubkeyOverrides;
  /** Outer type/struct name — used to scope override lookups. */
  outerTypeName?: string;
  /** Field name we are mapping — used for pubkey heuristic on `[u8;32]`. */
  fieldName?: string;
}

/**
 * Map an IDL type to a TypeScript type string.
 *
 * - Primitives map to native TS types (number for ≤32-bit ints, bigint for 64+).
 * - `[u8; 32]` maps to `PublicKey` or `Bytes32` per pubkey-detection rules.
 * - Other byte arrays map to `Uint8Array`.
 * - `vec<T>` -> `T[]`, `option<T>` -> `T | null`.
 * - `defined` references resolve to PascalCase TS type names.
 * - Enum-with-data (variants carrying fields) throws UnsupportedTypeError.
 */
export function mapIdlType(type: IdlType, ctx: MapTypeContext): string {
  if (typeof type === 'string') {
    return mapPrimitive(type);
  }
  if ('vec' in type) {
    const inner = mapIdlType(type.vec, ctx);
    return `${wrapIfUnion(inner)}[]`;
  }
  if ('option' in type) {
    const inner = mapIdlType(type.option, ctx);
    return `${inner} | null`;
  }
  if ('array' in type) {
    const [item, size] = type.array;
    // Special-case [u8; N] — runtime serializer returns a Buffer for u8 arrays,
    // but we surface it as Uint8Array (which Buffer extends) for portability.
    if (item === 'u8') {
      if (size === 32) {
        const override = lookupOverride(ctx.overrides, ctx.outerTypeName ?? '', ctx.fieldName ?? '');
        const cls = classifyBytesField(ctx.fieldName ?? '', size, override);
        return cls === 'publicKey' ? 'PublicKey' : 'Bytes32';
      }
      return 'Uint8Array';
    }
    const inner = mapIdlType(item, ctx);
    return `${wrapIfUnion(inner)}[]`;
  }
  if ('defined' in type) {
    const def = ctx.registry.get(type.defined);
    if (def && def.type.kind === 'enum') {
      // Enum-with-data: variants have fields. We only support tag-only enums.
      const variants = def.type.variants ?? [];
      const hasData = variants.some(v => 'fields' in (v as Record<string, unknown>) && (v as { fields?: unknown }).fields);
      if (hasData) {
        throw new UnsupportedTypeError(`enum '${type.defined}' has data-bearing variants (not supported in Phase 2)`);
      }
    }
    return pascalType(type.defined);
  }
  throw new UnsupportedTypeError(`unrecognized IDL type shape: ${JSON.stringify(type)}`);
}

function mapPrimitive(p: string): string {
  switch (p) {
    case 'u8':
    case 'i8':
    case 'u16':
    case 'i16':
    case 'u32':
    case 'i32':
    case 'f32':
    case 'f64':
      return 'number';
    case 'u64':
    case 'i64':
    case 'u128':
    case 'i128':
      return 'bigint';
    case 'bool':
      return 'boolean';
    case 'string':
      return 'string';
    case 'bytes':
      return 'Uint8Array';
    case 'publicKey':
      return 'PublicKey';
    default:
      throw new UnsupportedTypeError(`unknown primitive '${p}'`);
  }
}

function wrapIfUnion(t: string): string {
  // Wrap union types in parens when used inside `T[]` to keep precedence right.
  if (t.includes(' | ')) return `(${t})`;
  return t;
}

/**
 * Map an enum (tag-only) defined type to a TS string-literal union.
 * Returns the literal-union expression, e.g. "'A' | 'B' | 'C'".
 */
export function mapEnumVariants(def: IdlTypeDef): string {
  if (def.type.kind !== 'enum' || !def.type.variants) {
    throw new UnsupportedTypeError(`'${def.name}' is not a tag-only enum`);
  }
  const variants = def.type.variants;
  const hasData = variants.some(v => 'fields' in (v as Record<string, unknown>) && (v as { fields?: unknown }).fields);
  if (hasData) {
    throw new UnsupportedTypeError(`enum '${def.name}' has data-bearing variants (not supported in Phase 2)`);
  }
  if (variants.length === 0) return 'never';
  // SECURITY (CRIT-2 defense-in-depth): validate each variant name as a safe
  // identifier before interpolating into the single-quoted string-literal
  // union. Parser-level validation should already have rejected unsafe
  // names, but enforcing here too means this helper is safe to call on any
  // IdlTypeDef regardless of provenance.
  return variants
    .map(v => {
      sanitizeIdent(v.name); // throws UnsafeIdentError on bad input
      return `'${v.name}'`;
    })
    .join(' | ');
}
