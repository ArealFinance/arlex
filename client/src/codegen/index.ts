/**
 * Public surface of the @arlex/client codegen module.
 *
 * `generateTypes` is pure: it takes a parsed/raw IDL and an options object
 * and returns the source for `accounts.generated.ts`,
 * `instructions.generated.ts`, `errors.generated.ts`, and (Phase 3.5 C.2)
 * `defined-types.generated.ts` as strings. No file-system writes happen
 * here — that responsibility lives in the CLI / writer layer so the
 * module is easy to embed in build tooling and tests.
 */
import { parseIdl, type NormalizedIdl } from './parser';
import { emitAccountsSource } from './emit-accounts';
import { emitInstructionsSource } from './emit-instructions';
import { emitErrorsSource } from './emit-errors';
import { emitDefinedTypesSource } from './emit-defined-types';
import { buildBanner, generatedFilename, GENERATOR_VERSION } from './writer';
import type { PubkeyOverrides } from './pubkey-detection';

export interface GenerateTypesOptions {
  /** Optional sidecar overrides keyed by typeName -> fieldName -> classification. */
  pubkeyOverrides?: PubkeyOverrides;
  /** Override IDL `name` (used in banner). */
  programName?: string;
}

export interface GeneratedSources {
  accounts: string;
  instructions: string;
  errors: string;
  /** Per-program shared defined types + TYPE_REGISTRY (Phase 3.5 C.2). */
  definedTypes: string;
  /** Filenames the writer should use, in stable order. */
  filenames: {
    accounts: string;
    instructions: string;
    errors: string;
    definedTypes: string;
  };
}

/**
 * Generate TS source strings for all four output files.
 *
 * Accepts either a raw (unparsed) IDL object or an already-normalized one.
 */
export function generateTypes(
  idlOrRaw: NormalizedIdl | unknown,
  options: GenerateTypesOptions = {},
): GeneratedSources {
  const idl: NormalizedIdl = isNormalized(idlOrRaw) ? idlOrRaw : parseIdl(idlOrRaw);

  const banner = buildBanner({
    idlName: options.programName ?? idl.name,
    idlVersion: idl.version,
  });

  const definedTypes = banner + emitDefinedTypesSource(idl, { overrides: options.pubkeyOverrides });
  const accounts = banner + emitAccountsSource(idl, { overrides: options.pubkeyOverrides });
  const instructions = banner + emitInstructionsSource(idl, { overrides: options.pubkeyOverrides });
  const errors = banner + emitErrorsSource(idl);

  return {
    accounts,
    instructions,
    errors,
    definedTypes,
    filenames: {
      accounts: generatedFilename('accounts'),
      instructions: generatedFilename('instructions'),
      errors: generatedFilename('errors'),
      definedTypes: generatedFilename('defined-types'),
    },
  };
}

function isNormalized(v: unknown): v is NormalizedIdl {
  return (
    typeof v === 'object' &&
    v !== null &&
    'definedRegistry' in (v as Record<string, unknown>) &&
    (v as { definedRegistry: unknown }).definedRegistry instanceof Map
  );
}

export { parseIdl, parseIdlJson, IdlParseError } from './parser';
export type { NormalizedIdl } from './parser';
export { snakeToCamel, pascalCase, sanitizeIdent, camelField, pascalType, safeConstName, UnsafeIdentError } from './naming';
export { classifyBytesField, lookupOverride } from './pubkey-detection';
export type { PubkeyOverrides, PubkeyClassification } from './pubkey-detection';
export { mapIdlType, mapEnumVariants, UnsupportedTypeError } from './type-mapper';
export { emitAccountsSource } from './emit-accounts';
export { emitInstructionsSource } from './emit-instructions';
export { emitErrorsSource } from './emit-errors';
export { emitDefinedTypesSource } from './emit-defined-types';
export { writeIfChanged, checkDrift, buildBanner, generatedFilename, GENERATED_SUFFIX, GENERATOR_VERSION } from './writer';
export type { WriteResult } from './writer';
