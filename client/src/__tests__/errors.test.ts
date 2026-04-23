import { describe, it, expect } from 'vitest';
import { extractErrorCode, decodeError, ArlexProgramError } from '../errors';
import type { IdlError } from '../types';

const testErrors: IdlError[] = [
  { code: 6000, name: 'Unauthorized', msg: 'Not authorized' },
  { code: 6001, name: 'InsufficientFunds', msg: 'Not enough funds' },
  { code: 6002, name: 'Overflow', msg: 'Arithmetic overflow' },
];

describe('errors', () => {
  describe('extractErrorCode', () => {
    it('extracts from InstructionError format', () => {
      const err = { InstructionError: [0, { Custom: 6001 }] };
      expect(extractErrorCode(err)).toBe(6001);
    });

    it('extracts from camelCase format', () => {
      const err = { instructionError: [0, { Custom: 6000 }] };
      expect(extractErrorCode(err)).toBe(6000);
    });

    it('extracts from hex string format', () => {
      const err = { message: 'custom program error: 0x1770' };
      expect(extractErrorCode(err)).toBe(6000); // 0x1770 = 6000
    });

    it('returns null for non-custom error', () => {
      const err = { InstructionError: [0, 'AccountNotFound'] };
      expect(extractErrorCode(err)).toBeNull();
    });

    it('returns null for null input', () => {
      expect(extractErrorCode(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(extractErrorCode(undefined)).toBeNull();
    });

    it('returns null for empty object', () => {
      expect(extractErrorCode({})).toBeNull();
    });
  });

  describe('decodeError', () => {
    it('decodes known error code', () => {
      const err = decodeError(6001, testErrors);
      expect(err).toBeInstanceOf(ArlexProgramError);
      expect(err.code).toBe(6001);
      expect(err.errorName).toBe('InsufficientFunds');
      expect(err.message).toContain('Not enough funds');
    });

    it('decodes first error (6000)', () => {
      const err = decodeError(6000, testErrors);
      expect(err.errorName).toBe('Unauthorized');
    });

    it('returns UnknownError for unknown code', () => {
      const err = decodeError(9999, testErrors);
      expect(err.errorName).toBe('UnknownError');
      expect(err.code).toBe(9999);
    });

    it('returns UnknownError for empty errors list', () => {
      const err = decodeError(6000, []);
      expect(err.errorName).toBe('UnknownError');
    });
  });

  describe('ArlexProgramError', () => {
    it('is an Error instance', () => {
      const err = new ArlexProgramError(6000, 'Test', 'test msg');
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ArlexProgramError');
    });

    it('has code, errorName, message', () => {
      const err = new ArlexProgramError(6001, 'MyError', 'description');
      expect(err.code).toBe(6001);
      expect(err.errorName).toBe('MyError');
      expect(err.message).toContain('MyError');
      expect(err.message).toContain('6001');
      expect(err.message).toContain('description');
    });
  });
});
