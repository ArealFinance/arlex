/**
 * Naming utilities for codegen.
 *
 * The wire format (IDL/JSON/Borsh) uses snake_case for field names.
 * The TS surface uses camelCase for fields and PascalCase for types.
 * `sanitizeIdent` guards against TS reserved words and identifiers
 * starting with digits.
 */

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
 * - Prefixes a `_` if the name starts with a digit.
 * - Suffixes a `_` if the name collides with a TS reserved word.
 * - Returns `_` if the input is empty.
 */
export function sanitizeIdent(name: string): string {
  if (!name) return '_';
  let safe = name;
  if (/^[0-9]/.test(safe)) safe = `_${safe}`;
  if (TS_RESERVED.has(safe)) safe = `${safe}_`;
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
