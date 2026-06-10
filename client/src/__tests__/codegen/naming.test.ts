import { describe, it, expect } from 'vitest';
import { snakeToCamel, pascalCase, sanitizeIdent, camelField, pascalType } from '../../codegen/naming';

describe('snakeToCamel', () => {
  const cases: [string, string][] = [
    ['snake_case', 'snakeCase'],
    ['wallet_address', 'walletAddress'],
    ['total_staked', 'totalStaked'],
    ['next_proposal_id', 'nextProposalId'],
    ['ot_mint', 'otMint'],
    ['__leading', '__leading'],
    ['_one_two', '_oneTwo'],
    ['', ''],
    ['simple', 'simple'],
    ['kebab-case', 'kebabCase'],
    ['mixed_2_words', 'mixed2Words'],
    ['FutarchyConfig', 'futarchyConfig'],
    ['alreadyMixed', 'alreadyMixed'],
    // Number after separator becomes uppercased only if followed by a letter,
    // but our rule treats digits as regular tokens — verify deterministic.
    ['v1_alpha', 'v1Alpha'],
  ];
  for (const [input, expected] of cases) {
    it(`snakeToCamel(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, () => {
      expect(snakeToCamel(input)).toBe(expected);
    });
  }
});

describe('pascalCase', () => {
  const cases: [string, string][] = [
    ['wallet_address', 'WalletAddress'],
    ['walletAddress', 'WalletAddress'],
    ['AlreadyPascal', 'AlreadyPascal'],
    ['create_proposal', 'CreateProposal'],
    ['FutarchyConfig', 'FutarchyConfig'],
    ['', ''],
    ['x', 'X'],
    ['a_b_c', 'ABC'],
  ];
  for (const [input, expected] of cases) {
    it(`pascalCase(${JSON.stringify(input)}) → ${JSON.stringify(expected)}`, () => {
      expect(pascalCase(input)).toBe(expected);
    });
  }
});

describe('sanitizeIdent', () => {
  it('prefixes underscore for leading-digit names', () => {
    expect(sanitizeIdent('1abc')).toBe('_1abc');
    expect(sanitizeIdent('123')).toBe('_123');
  });
  it('suffixes underscore for reserved words', () => {
    expect(sanitizeIdent('class')).toBe('class_');
    expect(sanitizeIdent('default')).toBe('default_');
    expect(sanitizeIdent('new')).toBe('new_');
    expect(sanitizeIdent('public')).toBe('public_');
    expect(sanitizeIdent('void')).toBe('void_');
  });
  it('passes through normal identifiers', () => {
    expect(sanitizeIdent('foo')).toBe('foo');
    expect(sanitizeIdent('walletAddress')).toBe('walletAddress');
    expect(sanitizeIdent('_private')).toBe('_private');
  });
  it('returns _ for empty', () => {
    expect(sanitizeIdent('')).toBe('_');
  });
});

describe('camelField + pascalType', () => {
  it('camelField sanitizes after camelizing', () => {
    expect(camelField('class')).toBe('class_');
    expect(camelField('1_amount')).toBe('_1Amount');
  });
  it('pascalType sanitizes after pascal', () => {
    expect(pascalType('123_account')).toBe('_123Account');
    expect(pascalType('Class')).toBe('Class');
  });
});
