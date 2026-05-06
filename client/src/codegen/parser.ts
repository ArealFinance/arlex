/**
 * IDL JSON parser & normalizer.
 *
 * Validates the shape of an IDL document and resolves `defined` references
 * for downstream emitters. The parser is intentionally permissive about
 * optional sections (events, errors, types, metadata) so that minimal
 * IDLs (no errors, no events) still pass through cleanly.
 */
import type {
  Idl,
  IdlInstruction,
  IdlAccountDef,
  IdlTypeDef,
  IdlField,
  IdlType,
  IdlError,
  IdlEvent,
} from '../types';

export interface NormalizedIdl {
  version: string;
  name: string;
  programId?: string;
  instructions: IdlInstruction[];
  accounts: IdlAccountDef[];
  types: IdlTypeDef[];
  events: IdlEvent[];
  errors: IdlError[];
  /** Map of defined type name -> IdlTypeDef (includes accounts as struct types). */
  definedRegistry: Map<string, IdlTypeDef>;
}

export class IdlParseError extends Error {
  constructor(message: string) {
    super(`IDL parse error: ${message}`);
    this.name = 'IdlParseError';
  }
}

function assertIsObject(value: unknown, where: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IdlParseError(`${where} must be an object`);
  }
}

function assertIsArray(value: unknown, where: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new IdlParseError(`${where} must be an array`);
  }
}

function assertIsString(value: unknown, where: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new IdlParseError(`${where} must be a string`);
  }
}

/**
 * Identifier safety regex — same shape as the one in `naming.ts`. Defined
 * locally to avoid coupling the parser to the naming module.
 *
 * SECURITY (CRIT-1, CRIT-2, CRIT-4): every IDL field that ends up
 * interpolated into emitted TS source as an identifier MUST pass this gate.
 * Names that fail are rejected at parse time with a path-bearing error so
 * malicious IDLs are surfaced before any code is emitted.
 */
const IDL_SAFE_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function assertSafeIdent(value: string, where: string): void {
  if (!IDL_SAFE_IDENT_RE.test(value)) {
    throw new IdlParseError(
      `${where} is not a safe identifier: ${JSON.stringify(value)} ` +
      `(must match /^[A-Za-z_$][A-Za-z0-9_$]*$/)`,
    );
  }
}

/**
 * Banner-string safety regex — IDL `name` and `version` end up in a
 * single-line `//` banner comment. We accept word chars, dot, hyphen, plus,
 * and space; anything else (notably newlines, quotes, `*`, `/`) is rejected
 * so an attacker cannot terminate the comment and inject top-level
 * statements (CRIT-3).
 */
const IDL_SAFE_BANNER_RE = /^[\w.\-+ ]+$/;

function assertSafeBannerString(value: string, where: string): void {
  if (!IDL_SAFE_BANNER_RE.test(value)) {
    throw new IdlParseError(
      `${where} contains characters not permitted in the banner: ` +
      `${JSON.stringify(value)} (allowed: alphanumerics, '.', '-', '+', space)`,
    );
  }
}

function validateIdlType(type: unknown, where: string): IdlType {
  if (typeof type === 'string') return type as IdlType;
  if (type !== null && typeof type === 'object' && !Array.isArray(type)) {
    const obj = type as Record<string, unknown>;
    if ('vec' in obj) {
      return { vec: validateIdlType(obj.vec, `${where}.vec`) } as IdlType;
    }
    if ('option' in obj) {
      return { option: validateIdlType(obj.option, `${where}.option`) } as IdlType;
    }
    if ('array' in obj) {
      const arr = obj.array;
      if (!Array.isArray(arr) || arr.length !== 2 || typeof arr[1] !== 'number') {
        throw new IdlParseError(`${where}.array must be [type, number]`);
      }
      return { array: [validateIdlType(arr[0], `${where}.array[0]`), arr[1]] } as IdlType;
    }
    if ('defined' in obj) {
      assertIsString(obj.defined, `${where}.defined`);
      assertSafeIdent(obj.defined, `${where}.defined`);
      return { defined: obj.defined } as IdlType;
    }
  }
  throw new IdlParseError(`${where}: unrecognized type shape: ${JSON.stringify(type)}`);
}

function validateField(field: unknown, where: string): IdlField {
  assertIsObject(field, where);
  assertIsString(field.name, `${where}.name`);
  assertSafeIdent(field.name, `${where}.name`);
  return { name: field.name, type: validateIdlType(field.type, `${where}.type`) };
}

function validateInstruction(ix: unknown, where: string): IdlInstruction {
  assertIsObject(ix, where);
  assertIsString(ix.name, `${where}.name`);
  assertSafeIdent(ix.name, `${where}.name`);
  assertIsArray(ix.accounts, `${where}.accounts`);
  assertIsArray(ix.args, `${where}.args`);
  return {
    name: ix.name,
    accounts: ix.accounts.map((a, i) => {
      assertIsObject(a, `${where}.accounts[${i}]`);
      assertIsString(a.name, `${where}.accounts[${i}].name`);
      assertSafeIdent(a.name, `${where}.accounts[${i}].name`);
      return {
        name: a.name,
        isMut: Boolean(a.isMut),
        isSigner: Boolean(a.isSigner),
      };
    }),
    args: ix.args.map((f, i) => validateField(f, `${where}.args[${i}]`)),
  };
}

function validateAccountDef(acc: unknown, where: string): IdlAccountDef {
  assertIsObject(acc, where);
  assertIsString(acc.name, `${where}.name`);
  assertSafeIdent(acc.name, `${where}.name`);
  assertIsObject(acc.type, `${where}.type`);
  assertIsString(acc.type.kind, `${where}.type.kind`);
  if (acc.type.kind !== 'struct') {
    throw new IdlParseError(`${where}.type.kind must be 'struct' for accounts (got '${acc.type.kind}')`);
  }
  assertIsArray(acc.type.fields, `${where}.type.fields`);
  return {
    name: acc.name,
    type: {
      kind: acc.type.kind,
      fields: acc.type.fields.map((f, i) => validateField(f, `${where}.type.fields[${i}]`)),
    },
  };
}

function validateTypeDef(td: unknown, where: string): IdlTypeDef {
  assertIsObject(td, where);
  assertIsString(td.name, `${where}.name`);
  assertSafeIdent(td.name, `${where}.name`);
  assertIsObject(td.type, `${where}.type`);
  assertIsString(td.type.kind, `${where}.type.kind`);
  const kind = td.type.kind;
  if (kind === 'struct') {
    assertIsArray(td.type.fields, `${where}.type.fields`);
    return {
      name: td.name,
      type: {
        kind,
        fields: td.type.fields.map((f, i) => validateField(f, `${where}.type.fields[${i}]`)),
      },
    };
  }
  if (kind === 'enum') {
    assertIsArray(td.type.variants, `${where}.type.variants`);
    const variants = td.type.variants.map((v, i) => {
      assertIsObject(v, `${where}.type.variants[${i}]`);
      assertIsString(v.name, `${where}.type.variants[${i}].name`);
      assertSafeIdent(v.name, `${where}.type.variants[${i}].name`);
      // Note: enum-with-data is intentionally NOT rejected here — the type-mapper
      // is the one that throws on first encounter. This keeps the parser pure.
      return { name: v.name };
    });
    return { name: td.name, type: { kind, variants } };
  }
  throw new IdlParseError(`${where}.type.kind must be 'struct' or 'enum' (got '${kind}')`);
}

function validateEvent(ev: unknown, where: string): IdlEvent {
  assertIsObject(ev, where);
  assertIsString(ev.name, `${where}.name`);
  assertSafeIdent(ev.name, `${where}.name`);
  assertIsArray(ev.fields, `${where}.fields`);
  return {
    name: ev.name,
    fields: ev.fields.map((f, i) => validateField(f, `${where}.fields[${i}]`)),
  };
}

function validateError(err: unknown, where: string): IdlError {
  assertIsObject(err, where);
  if (typeof err.code !== 'number') {
    throw new IdlParseError(`${where}.code must be a number`);
  }
  assertIsString(err.name, `${where}.name`);
  assertSafeIdent(err.name, `${where}.name`);
  assertIsString(err.msg, `${where}.msg`);
  return { code: err.code, name: err.name, msg: err.msg };
}

/**
 * Parse and normalize an Anchor-style IDL document.
 *
 * - Validates required shape (version, name, instructions, accounts).
 * - Coerces optional sections to empty arrays.
 * - Builds a `definedRegistry` covering both `types[]` and `accounts[]`.
 */
export function parseIdl(raw: unknown): NormalizedIdl {
  assertIsObject(raw, 'idl');
  assertIsString(raw.version, 'idl.version');
  assertIsString(raw.name, 'idl.name');
  // Both fields land in the banner comment of every emitted file; reject any
  // characters that could break out of the `//` context (CRIT-3).
  assertSafeBannerString(raw.version, 'idl.version');
  assertSafeBannerString(raw.name, 'idl.name');

  const instructionsRaw = raw.instructions ?? [];
  const accountsRaw = raw.accounts ?? [];
  const typesRaw = raw.types ?? [];
  const eventsRaw = raw.events ?? [];
  const errorsRaw = raw.errors ?? [];

  assertIsArray(instructionsRaw, 'idl.instructions');
  assertIsArray(accountsRaw, 'idl.accounts');
  assertIsArray(typesRaw, 'idl.types');
  assertIsArray(eventsRaw, 'idl.events');
  assertIsArray(errorsRaw, 'idl.errors');

  const instructions = instructionsRaw.map((ix, i) => validateInstruction(ix, `idl.instructions[${i}]`));
  const accounts = accountsRaw.map((a, i) => validateAccountDef(a, `idl.accounts[${i}]`));
  const types = typesRaw.map((t, i) => validateTypeDef(t, `idl.types[${i}]`));
  const events = eventsRaw.map((e, i) => validateEvent(e, `idl.events[${i}]`));
  const errors = errorsRaw.map((e, i) => validateError(e, `idl.errors[${i}]`));

  // Build registry — accounts also get registered as struct types so that
  // `{ defined: "AccountName" }` references inside instruction args resolve.
  const definedRegistry = new Map<string, IdlTypeDef>();
  for (const t of types) definedRegistry.set(t.name, t);
  for (const a of accounts) {
    if (!definedRegistry.has(a.name)) {
      definedRegistry.set(a.name, { name: a.name, type: a.type });
    }
  }

  // Sanity-check: every defined reference resolves
  const checkType = (type: IdlType, where: string) => {
    if (typeof type === 'string') return;
    if ('defined' in type && !definedRegistry.has(type.defined)) {
      throw new IdlParseError(`${where}: unresolved 'defined' reference: ${type.defined}`);
    }
    if ('vec' in type) checkType(type.vec, `${where}.vec`);
    if ('option' in type) checkType(type.option, `${where}.option`);
    if ('array' in type) checkType(type.array[0], `${where}.array`);
  };

  for (const ix of instructions) {
    for (const arg of ix.args) checkType(arg.type, `instruction '${ix.name}' arg '${arg.name}'`);
  }
  for (const acc of accounts) {
    for (const f of acc.type.fields) checkType(f.type, `account '${acc.name}' field '${f.name}'`);
  }
  for (const td of types) {
    if (td.type.kind === 'struct' && td.type.fields) {
      for (const f of td.type.fields) checkType(f.type, `type '${td.name}' field '${f.name}'`);
    }
  }

  const programId =
    raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
      ? typeof (raw.metadata as Record<string, unknown>).address === 'string'
        ? ((raw.metadata as Record<string, unknown>).address as string)
        : undefined
      : undefined;

  return {
    version: raw.version,
    name: raw.name,
    programId,
    instructions,
    accounts,
    types,
    events,
    errors,
    definedRegistry,
  };
}

/** Convenience: parse an IDL from a JSON string. */
export function parseIdlJson(text: string): NormalizedIdl {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new IdlParseError(`invalid JSON: ${(e as Error).message}`);
  }
  return parseIdl(parsed);
}

/** Re-export Idl type for emitters that prefer working with the raw shape. */
export type { Idl };
