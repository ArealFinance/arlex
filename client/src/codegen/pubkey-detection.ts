/**
 * Heuristic + override-based detection of `[u8; 32]` fields that should be
 * surfaced as `PublicKey` instead of raw `Uint8Array` (`Bytes32`).
 *
 * Rules (architect plan):
 *   1. Suffix-only heuristic match against PUBKEY_SUFFIXES.
 *   2. AND field name does NOT contain any token in NEGATIVE_TOKENS.
 *   3. OR explicit override in sidecar config.
 *   4. Override always wins over heuristic.
 *
 * Inputs are the raw IDL field name (snake_case is expected, but we
 * normalize defensively so camelCase also works).
 */
import type { IdlField } from '../types';

export type PubkeyClassification = 'publicKey' | 'bytes32';

/** Per-type, per-field overrides loaded from sidecar JSON. */
export type PubkeyOverrides = Record<string, Record<string, PubkeyClassification>>;

const PUBKEY_SUFFIXES = [
  'authority',
  'owner',
  'pubkey',
  'address',
  'payer',
  'recipient',
  'treasury',
  'mint',
  'token',
  'program',
  'signer',
  'creator',
  'admin',
  'destination',
  'dest',
  'source',
  'src',
  'oracle',
  'keeper',
  'proposer',
  'executor',
  'feed',
];

const NEGATIVE_TOKENS = [
  'hash',
  'root',
  'seed',
  'nonce',
  'digest',
  'commitment',
  'bump_seed',
];

/** Normalize field name to lower snake_case for matching. */
function normalize(name: string): string {
  return name
    // camelCase -> snake_case
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function endsWithSuffix(name: string): boolean {
  for (const suffix of PUBKEY_SUFFIXES) {
    if (name === suffix) return true;
    if (name.endsWith(`_${suffix}`)) return true;
  }
  return false;
}

function hasNegativeToken(name: string): boolean {
  for (const token of NEGATIVE_TOKENS) {
    // bump_seed is a multi-word token — treat it as a substring match,
    // others must appear as their own underscore-bounded word.
    if (token.includes('_')) {
      if (name.includes(token)) return true;
    } else {
      const re = new RegExp(`(^|_)${token}(_|$)`);
      if (re.test(name)) return true;
    }
  }
  return false;
}

/**
 * Classify a `[u8; 32]` field as `publicKey` or `bytes32`.
 *
 * @param fieldName  Raw IDL field name (snake_case or camelCase).
 * @param byteLen    Array length (must be 32 for publicKey to be considered).
 * @param override   Optional explicit classification from sidecar config.
 */
export function classifyBytesField(
  fieldName: string,
  byteLen: number,
  override?: PubkeyClassification,
): PubkeyClassification {
  // Override always wins.
  if (override) return override;
  if (byteLen !== 32) return 'bytes32';

  const norm = normalize(fieldName);
  if (hasNegativeToken(norm)) return 'bytes32';
  if (endsWithSuffix(norm)) return 'publicKey';
  return 'bytes32';
}

/**
 * Look up an override for a (typeName, fieldName) pair.
 *
 * Lookups try the raw field name first, then the normalized snake_case
 * form so that sidecar files can be written in either style.
 */
export function lookupOverride(
  overrides: PubkeyOverrides | undefined,
  typeName: string,
  fieldName: string,
): PubkeyClassification | undefined {
  if (!overrides) return undefined;
  const typeMap = overrides[typeName];
  if (!typeMap) return undefined;
  if (typeMap[fieldName]) return typeMap[fieldName];
  const norm = normalize(fieldName);
  if (typeMap[norm]) return typeMap[norm];
  return undefined;
}

/**
 * Walk a list of IDL fields and return the (raw IDL) names of every
 * `[u8; 32]` field classified as `publicKey` (per heuristic + overrides).
 *
 * Used by codegen to emit a `PUBKEY_<TYPE>_FIELDS` set so the runtime
 * decoder can wrap matching values with `new PublicKey(...)`. Without this,
 * runtime parsers return `Uint8Array` for pubkey-overridden fields even
 * though the emitted `.d.ts` types declare `PublicKey`.
 *
 * Fields are returned in declaration order. Only top-level `[u8; 32]`
 * fields are inspected — nested defined-struct fields are handled by
 * the consumer of those types via their own PUBKEY_* set.
 */
export function collectPubkeyFieldNames(
  fields: IdlField[],
  outerTypeName: string,
  overrides?: PubkeyOverrides,
): string[] {
  const result: string[] = [];
  for (const f of fields) {
    if (typeof f.type !== 'object' || !('array' in f.type)) continue;
    const [item, size] = f.type.array;
    if (item !== 'u8' || size !== 32) continue;
    const override = lookupOverride(overrides, outerTypeName, f.name);
    const cls = classifyBytesField(f.name, size, override);
    if (cls === 'publicKey') result.push(f.name);
  }
  return result;
}

/** Constants exported for tests. */
export const _PUBKEY_SUFFIXES = PUBKEY_SUFFIXES;
export const _NEGATIVE_TOKENS = NEGATIVE_TOKENS;
