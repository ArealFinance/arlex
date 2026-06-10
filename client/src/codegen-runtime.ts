/**
 * Runtime helpers consumed by codegen-emitted files.
 *
 * Generated files import only from `@arlex/client/codegen-runtime` (this
 * module). Keeping a dedicated entry point lets us evolve the public surface
 * of `@arlex/client` independently from the codegen contract.
 */
import { PublicKey } from '@solana/web3.js';
import {
  serializeArgs as _serializeArgs,
  deserializeAccount as _deserializeAccount,
  buildTypeRegistry as _buildTypeRegistry,
  type TypeRegistry,
} from './serialization';
import {
  instructionDiscriminator as _instructionDiscriminator,
  accountDiscriminator as _accountDiscriminator,
} from './discriminator';
import {
  decodeError as _decodeError,
  ArlexProgramError,
  extractErrorCode as _extractErrorCode,
} from './errors';
import type { IdlField, IdlError, IdlTypeDef } from './types';

export { PublicKey };
export { _serializeArgs as serializeArgs };
export { _deserializeAccount as deserializeAccount };
export { _buildTypeRegistry as buildTypeRegistry };
export type { TypeRegistry };
export { _instructionDiscriminator as instructionDiscriminator };
export { _accountDiscriminator as accountDiscriminator };
export { _decodeError as decodeError };
export { _extractErrorCode as extractErrorCode };
export { ArlexProgramError };
export type { IdlField, IdlError, IdlTypeDef };

/**
 * 32-byte fixed array surfaced when pubkey-detection classifies a field as
 * `bytes32` (e.g. cryptographic hashes / merkle roots). Buffer is a Uint8Array
 * subclass at runtime, so callers can use either interchangeably.
 */
export type Bytes32 = Uint8Array;

/**
 * Translate a flat `Record<string, any>` from `deserializeAccount` to the
 * camelCase TS shape declared in generated interfaces.
 *
 * The generated parser passes its `WireFieldMap` (snake_case key ->
 * camelCase TS field). Defined-type fields are recursively translated via
 * `nestedMaps`.
 */
export type WireFieldMap = Record<string, string>;

/**
 * Per-field options passed to a nested-struct remap. Lets the caller hand
 * the nested level both its own WIRE map AND its own PUBKEY-field set so
 * that `[u8; 32]` fields inside a defined struct are also wrapped as
 * `PublicKey` when the override classifies them that way.
 */
export interface NestedRemapTarget {
  map: WireFieldMap;
  pubkeyFields?: readonly string[];
  /** Recursive nested options for fields inside this nested struct. */
  nestedMaps?: Record<string, NestedRemapTarget>;
  arrayMaps?: Record<string, NestedRemapTarget>;
}

export interface RemapOptions {
  /** TS-field-name -> nested WireFieldMap or {map, pubkeyFields} (for `defined` struct fields). */
  nestedMaps?: Record<string, WireFieldMap | NestedRemapTarget>;
  /** TS-field-name -> nested WireFieldMap or {map, pubkeyFields} (for `vec<defined>` or `[defined; N]`). */
  arrayMaps?: Record<string, WireFieldMap | NestedRemapTarget>;
  /**
   * TS-field-names of `[u8; 32]` fields whose decoded `Uint8Array` value
   * should be wrapped in `new PublicKey(...)`. Set by codegen from the
   * pubkey-detection classification + sidecar overrides.
   */
  pubkeyFields?: readonly string[];
}

/** Coerce a `WireFieldMap | NestedRemapTarget` into the structured form. */
function asNestedTarget(v: WireFieldMap | NestedRemapTarget | undefined): NestedRemapTarget | undefined {
  if (!v) return undefined;
  // NestedRemapTarget always has a `map` property; a bare WireFieldMap is a
  // flat string->string record. The `map` key in a WireFieldMap would be a
  // wire-field name pointing to a TS-field name (string), not an object.
  const maybeMap = (v as NestedRemapTarget).map;
  if (maybeMap && typeof maybeMap === 'object') return v as NestedRemapTarget;
  return { map: v as WireFieldMap };
}

/**
 * Wrap a decoded `[u8; 32]` value in a `PublicKey`. Idempotent — returns
 * the input untouched if it is already a `PublicKey` instance.
 */
function wrapPubkey(value: unknown): unknown {
  if (value instanceof PublicKey) return value;
  if (value instanceof Uint8Array) return new PublicKey(value);
  if (Array.isArray(value)) return new PublicKey(Uint8Array.from(value as number[]));
  return value;
}

export function remapWireToTs(
  raw: Record<string, unknown>,
  map: WireFieldMap,
  options: RemapOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pubkeySet = options.pubkeyFields ? new Set(options.pubkeyFields) : null;
  for (const wireKey of Object.keys(map)) {
    const tsKey = map[wireKey];
    const value = raw[wireKey];
    const nested = asNestedTarget(options.nestedMaps?.[tsKey]);
    const arrayMap = asNestedTarget(options.arrayMaps?.[tsKey]);
    if (nested && value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)) {
      out[tsKey] = remapWireToTs(value as Record<string, unknown>, nested.map, {
        nestedMaps: nested.nestedMaps,
        arrayMaps: nested.arrayMaps,
        pubkeyFields: nested.pubkeyFields,
      });
    } else if (arrayMap && Array.isArray(value)) {
      out[tsKey] = value.map(item =>
        item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Uint8Array)
          ? remapWireToTs(item as Record<string, unknown>, arrayMap.map, {
              nestedMaps: arrayMap.nestedMaps,
              arrayMaps: arrayMap.arrayMaps,
              pubkeyFields: arrayMap.pubkeyFields,
            })
          : item,
      );
    } else if (pubkeySet && pubkeySet.has(tsKey)) {
      // Apply pubkey-override classification: wrap raw bytes as PublicKey.
      out[tsKey] = wrapPubkey(value);
    } else {
      out[tsKey] = value;
    }
  }
  return out;
}

/**
 * Reverse direction — TS camelCase shape to wire snake_case shape, used by
 * generated `encode*` helpers before delegating to `serializeArgs`.
 */
export function remapTsToWire(
  ts: Record<string, unknown>,
  map: WireFieldMap,
  options: RemapOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const wireKey of Object.keys(map)) {
    const tsKey = map[wireKey];
    const value = ts[tsKey];
    const nested = asNestedTarget(options.nestedMaps?.[tsKey]);
    const arrayMap = asNestedTarget(options.arrayMaps?.[tsKey]);
    // PublicKey instances pass through verbatim — `serializeArgs` knows how
    // to write them for `[u8; 32]` fields. Treating them as "objects to
    // recurse into" would corrupt the wire shape.
    if (nested && value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof PublicKey) && !(value instanceof Uint8Array)) {
      out[wireKey] = remapTsToWire(value as Record<string, unknown>, nested.map, {
        nestedMaps: nested.nestedMaps,
        arrayMaps: nested.arrayMaps,
      });
    } else if (arrayMap && Array.isArray(value)) {
      out[wireKey] = value.map(item =>
        item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof PublicKey) && !(item instanceof Uint8Array)
          ? remapTsToWire(item as Record<string, unknown>, arrayMap.map, {
              nestedMaps: arrayMap.nestedMaps,
              arrayMaps: arrayMap.arrayMaps,
            })
          : item,
      );
    } else {
      out[wireKey] = value;
    }
  }
  return out;
}

/**
 * Verify that a buffer's first 8 bytes match an expected discriminator.
 * Throws with a helpful hex diff on mismatch.
 */
export function parseDiscriminator(data: Buffer | Uint8Array, expected: Uint8Array, context: string): void {
  if (data.length < 8) {
    throw new Error(`${context}: data too short (${data.length} bytes, need >= 8)`);
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) {
      const got = Buffer.from(data.subarray(0, 8)).toString('hex');
      const want = Buffer.from(expected).toString('hex');
      throw new Error(`${context}: discriminator mismatch — expected ${want}, got ${got}`);
    }
  }
}
