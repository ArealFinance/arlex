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

export interface RemapOptions {
  /** TS-field-name -> nested WireFieldMap (for `defined` struct fields). */
  nestedMaps?: Record<string, WireFieldMap>;
  /** TS-field-name -> nested WireFieldMap (for `vec<defined>` or `[defined; N]`). */
  arrayMaps?: Record<string, WireFieldMap>;
}

export function remapWireToTs(
  raw: Record<string, unknown>,
  map: WireFieldMap,
  options: RemapOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const wireKey of Object.keys(map)) {
    const tsKey = map[wireKey];
    const value = raw[wireKey];
    const nested = options.nestedMaps?.[tsKey];
    const arrayMap = options.arrayMaps?.[tsKey];
    if (nested && value && typeof value === 'object' && !Array.isArray(value)) {
      out[tsKey] = remapWireToTs(value as Record<string, unknown>, nested);
    } else if (arrayMap && Array.isArray(value)) {
      out[tsKey] = value.map(item =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? remapWireToTs(item as Record<string, unknown>, arrayMap)
          : item,
      );
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
    const nested = options.nestedMaps?.[tsKey];
    const arrayMap = options.arrayMaps?.[tsKey];
    if (nested && value && typeof value === 'object' && !Array.isArray(value)) {
      out[wireKey] = remapTsToWire(value as Record<string, unknown>, nested);
    } else if (arrayMap && Array.isArray(value)) {
      out[wireKey] = value.map(item =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? remapTsToWire(item as Record<string, unknown>, arrayMap)
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
