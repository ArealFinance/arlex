/**
 * Naming utilities for codegen.
 *
 * The wire format (IDL/JSON/Borsh) uses snake_case for field names.
 * The TS surface uses camelCase for fields and PascalCase for types.
 * `sanitizeIdent` guards against TS reserved words and identifiers
 * starting with digits.
 *
 * SECURITY: identifiers from IDL inputs are interpolated into emitted TS
 * source. To prevent code injection (CRIT-1, CRIT-4), `sanitizeIdent` is
 * the canonical chokepoint and THROWS `UnsafeIdentError` on any input that
 * contains characters outside the safe identifier alphabet. All emitters
 * MUST funnel raw IDL names through `sanitizeIdent` (directly or via
 * `camelField` / `pascalType` / `safeConstName`) before interpolation.
 */

/** Identifier safety regex: matches a single legal TS/JS identifier. */
const SAFE_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Thrown by `sanitizeIdent` when input contains characters that could
 *  break out of an identifier context in emitted source. */
export class UnsafeIdentError extends Error {
  constructor(name: string, hint?: string) {
    const detail = hint ? ` (${hint})` : '';
    super(`unsafe identifier from IDL: ${JSON.stringify(name)}${detail}`);
    this.name = 'UnsafeIdentError';
  }
}

const TS_RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'as', 'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
  'static', 'yield', 'any', 'boolean', 'constructor', 'declare', 'get', 'module',
  'require', 'number', 'set', 'string', 'symbol', 'type', 'from', 'of', 'await',
  'async',
]);

/**
 * Convert snake_case (or kebab-case) to camelCase.
 *
 * If the input contains separators, words are split on `_`/`-` and the
 * first letter of each subsequent word is uppercased. If the input is
 * already in mixedCase (no separators), it is returned with the first
 * character lowercased — preserving any internal capitals.
 *
 * Examples:
 *   snake_case       -> snakeCase
 *   wallet_address   -> walletAddress
 *   total_staked     -> totalStaked
 *   __leading        -> __leading        (preserves leading underscores)
 *   FutarchyConfig   -> futarchyConfig   (no separators, just lowercases first char)
 *   alreadyMixed     -> alreadyMixed
 */
export function snakeToCamel(input: string): string {
  if (!input) return input;
  const leadingMatch = input.match(/^_+/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const body = input.slice(leading.length);
  // No separators → preserve internal case, only lowercase first char.
  if (!/[_-]/.test(body)) {
    if (body.length === 0) return leading;
    return leading + body.charAt(0).toLowerCase() + body.slice(1);
  }
  // Has separators → lowercase + camelize.
  const camel = body
    .toLowerCase()
    .replace(/[_-]+([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
  return leading + camel;
}

/**
 * Convert snake_case / camelCase / PascalCase to PascalCase.
 *
 * Examples:
 *   wallet_address  -> WalletAddress
 *   walletAddress   -> WalletAddress
 *   AlreadyPascal   -> AlreadyPascal
 *   FutarchyConfig  -> FutarchyConfig
 *   create_proposal -> CreateProposal
 */
export function pascalCase(input: string): string {
  if (!input) return input;
  const camel = snakeToCamel(input.replace(/^_+/, ''));
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Make an identifier safe for use as a TS variable / property name.
 *
 * Contract:
 * - Prefixes `_` if the name starts with a digit.
 * - Suffixes `_` if the name collides with a TS reserved word.
 * - Returns `_` if the input is empty.
 * - **Throws `UnsafeIdentError`** if the (post-prefix) string contains any
 *   character outside `[A-Za-z0-9_$]`. This is the chokepoint that prevents
 *   IDL-driven code injection into emitted TS source.
 */
export function sanitizeIdent(name: string): string {
  if (!name) return '_';
  let safe = name;
  if (/^[0-9]/.test(safe)) safe = `_${safe}`;
  if (TS_RESERVED.has(safe)) safe = `${safe}_`;
  if (!SAFE_IDENT_RE.test(safe)) {
    throw new UnsafeIdentError(name, 'must match /^[A-Za-z_$][A-Za-z0-9_$]*$/');
  }
  return safe;
}

/** Combined helper: snake_case wire name -> safe camelCase TS field name. */
export function camelField(name: string): string {
  return sanitizeIdent(snakeToCamel(name));
}

/** Combined helper: snake_case / pascal name -> safe PascalCase TS type name. */
export function pascalType(name: string): string {
  return sanitizeIdent(pascalCase(name));
}

/**
 * Build a SCREAMING_SNAKE constant-name fragment from a raw IDL name.
 *
 * Validates that the raw input is itself a safe identifier (per the same
 * rules `sanitizeIdent` enforces) and then uppercases it. Used for
 * `*_DISCRIMINATOR`, `WIRE_*_FIELDS`, `IDL_*_FIELDS` etc. so that emitters
 * cannot interpolate attacker-controlled punctuation through a raw
 * `.toUpperCase()` on `acc.name` / `ix.name`.
 *
 * Preserves snake_case (snake_case -> SNAKE_CASE) so existing generated
 * output for snake_case-named instructions is byte-identical.
 */
export function safeConstName(name: string): string {
  // sanitizeIdent throws if `name` is not a legal identifier — exactly the
  // guarantee we need before any raw uppercase interpolation.
  sanitizeIdent(name);
  return name.toUpperCase();
}
