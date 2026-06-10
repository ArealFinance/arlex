/**
 * Emit ProgramErrorCode enum + ProgramErrors map + decodeProgramError wrapper.
 *
 * The output is a single TS module exporting:
 *   - `ProgramErrorCode` — numeric enum of all named error codes.
 *   - `ProgramErrors` — full IdlError[] (code/name/msg) for runtime use.
 *   - `decodeProgramError(code | err): ArlexProgramError` — convenience wrapper
 *     around the runtime `decodeError` / `extractErrorCode` helpers.
 */
import { sanitizeIdent, pascalType } from './naming';
import type { NormalizedIdl } from './parser';

export interface EmitErrorsOptions {
  /** Optional ProgramErrorCode enum prefix (default: none). */
  enumName?: string;
}

export function emitErrorsSource(idl: NormalizedIdl, options: EmitErrorsOptions = {}): string {
  const enumName = options.enumName ?? 'ProgramErrorCode';
  const lines: string[] = [];

  lines.push(
    `import {`,
    `  ArlexProgramError,`,
    `  decodeError,`,
    `  extractErrorCode,`,
    `  type IdlError,`,
    `} from '@arlex/client/codegen-runtime';`,
    '',
  );

  // Numeric enum — order by code ascending for determinism.
  const sorted = [...idl.errors].sort((a, b) => a.code - b.code);
  if (sorted.length === 0) {
    lines.push(`/** No errors declared in IDL. */`);
    lines.push(`export enum ${enumName} {}`);
    lines.push('');
    lines.push(`export const ProgramErrors: IdlError[] = [];`);
    lines.push('');
  } else {
    lines.push(`/**`);
    lines.push(` * Numeric error codes from the program IDL.`);
    lines.push(` * Names are guaranteed unique within the IDL by Anchor convention.`);
    lines.push(` */`);
    lines.push(`export enum ${enumName} {`);
    for (const err of sorted) {
      const name = sanitizeIdent(pascalType(err.name));
      // Emit message as a leading JSDoc so IDE hover shows it.
      lines.push(`  /** ${escapeComment(err.msg)} */`);
      lines.push(`  ${name} = ${err.code},`);
    }
    lines.push(`}`);
    lines.push('');

    lines.push(`/** Full IDL error list — code, name, message. */`);
    lines.push(`export const ProgramErrors: IdlError[] = [`);
    for (const err of sorted) {
      lines.push(`  { code: ${err.code}, name: ${JSON.stringify(err.name)}, msg: ${JSON.stringify(err.msg)} },`);
    }
    lines.push(`];`);
    lines.push('');
  }

  lines.push(`/**`);
  lines.push(` * Decode a numeric error code (or a Solana RPC error) into a typed`);
  lines.push(` * \`ArlexProgramError\`. Returns \`null\` when no recognizable code is found.`);
  lines.push(` */`);
  lines.push(`export function decodeProgramError(input: number | unknown): ArlexProgramError | null {`);
  lines.push(`  let code: number | null;`);
  lines.push(`  if (typeof input === 'number') {`);
  lines.push(`    code = input;`);
  lines.push(`  } else {`);
  lines.push(`    code = extractErrorCode(input);`);
  lines.push(`  }`);
  lines.push(`  if (code === null) return null;`);
  lines.push(`  return decodeError(code, ProgramErrors);`);
  lines.push(`}`);
  lines.push('');

  return lines.join('\n');
}

function escapeComment(s: string): string {
  return s.replace(/\*\//g, '*\\/');
}
