import type { IdlError } from './types';

/**
 * Custom program error with IDL-decoded name and message
 */
export class ArlexProgramError extends Error {
  constructor(
    public code: number,
    public errorName: string,
    message: string,
  ) {
    super(`${errorName} (${code}): ${message}`);
    this.name = 'ArlexProgramError';
  }
}

/**
 * Decode a numeric error code into a named error from the IDL
 */
export function decodeError(code: number, errors: IdlError[]): ArlexProgramError {
  const found = errors.find(e => e.code === code);
  if (found) {
    return new ArlexProgramError(found.code, found.name, found.msg);
  }
  return new ArlexProgramError(code, 'UnknownError', `Error code: ${code}`);
}

/**
 * Extract custom error code from a Solana transaction error
 */
export function extractErrorCode(err: any): number | null {
  // InstructionError format: [index, { Custom: code }]
  const instrErr = err?.InstructionError || err?.instructionError;
  if (Array.isArray(instrErr) && instrErr[1]?.Custom !== undefined) {
    return instrErr[1].Custom;
  }
  // String format: "custom program error: 0x1770"
  const msg = err?.message || err?.toString?.() || '';
  const match = msg.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (match) return parseInt(match[1], 16);
  return null;
}
