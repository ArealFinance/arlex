import { describe, it, expect } from 'vitest';
import { classifyBytesField, lookupOverride, _PUBKEY_SUFFIXES, _NEGATIVE_TOKENS } from '../../codegen/pubkey-detection';

describe('classifyBytesField — heuristic positive', () => {
  // Each suffix should be detected when used as a suffix.
  for (const suffix of _PUBKEY_SUFFIXES) {
    it(`'something_${suffix}' → publicKey`, () => {
      expect(classifyBytesField(`something_${suffix}`, 32)).toBe('publicKey');
    });
    it(`bare '${suffix}' → publicKey`, () => {
      expect(classifyBytesField(suffix, 32)).toBe('publicKey');
    });
  }

  it('camelCase is normalized to snake_case before matching', () => {
    expect(classifyBytesField('walletAuthority', 32)).toBe('publicKey');
    expect(classifyBytesField('tokenMint', 32)).toBe('publicKey');
    expect(classifyBytesField('feeRecipient', 32)).toBe('publicKey');
  });
});

describe('classifyBytesField — negative tokens', () => {
  for (const tok of _NEGATIVE_TOKENS) {
    it(`'${tok}' present → bytes32 even with pubkey suffix`, () => {
      // construct a name with negative token AND pubkey suffix
      const name = `${tok}_authority`;
      // 'hash_authority' should be bytes32 because hash is in negative list
      expect(classifyBytesField(name, 32)).toBe('bytes32');
    });
  }
  it('params_hash → bytes32', () => {
    expect(classifyBytesField('params_hash', 32)).toBe('bytes32');
  });
  it('merkle_root → bytes32', () => {
    expect(classifyBytesField('merkle_root', 32)).toBe('bytes32');
  });
  it('bump_seed → bytes32', () => {
    expect(classifyBytesField('bump_seed', 32)).toBe('bytes32');
  });
  it('commitment → bytes32', () => {
    expect(classifyBytesField('commitment', 32)).toBe('bytes32');
  });
});

describe('classifyBytesField — non-32 byte arrays', () => {
  it('returns bytes32 for non-32 lengths regardless of name', () => {
    expect(classifyBytesField('authority', 16)).toBe('bytes32');
    expect(classifyBytesField('mint', 64)).toBe('bytes32');
    expect(classifyBytesField('owner', 200)).toBe('bytes32');
  });
});

describe('classifyBytesField — heuristic miss', () => {
  it('unrelated names default to bytes32', () => {
    expect(classifyBytesField('label', 32)).toBe('bytes32');
    expect(classifyBytesField('name', 32)).toBe('bytes32');
    expect(classifyBytesField('symbol', 32)).toBe('bytes32');
    expect(classifyBytesField('data_blob', 32)).toBe('bytes32');
  });
});

describe('classifyBytesField — overrides win', () => {
  it('publicKey override beats negative-token rule', () => {
    expect(classifyBytesField('params_hash', 32, 'publicKey')).toBe('publicKey');
  });
  it('bytes32 override beats positive heuristic', () => {
    expect(classifyBytesField('authority', 32, 'bytes32')).toBe('bytes32');
  });
  it('override applied even when length != 32', () => {
    expect(classifyBytesField('foo', 16, 'publicKey')).toBe('publicKey');
  });
});

describe('lookupOverride', () => {
  const overrides = {
    Pool: { liquidity_root: 'publicKey' as const, custom_name: 'bytes32' as const },
    Vault: { authority: 'bytes32' as const },
  };
  it('finds raw snake_case match', () => {
    expect(lookupOverride(overrides, 'Pool', 'liquidity_root')).toBe('publicKey');
    expect(lookupOverride(overrides, 'Vault', 'authority')).toBe('bytes32');
  });
  it('falls back to normalized snake_case match', () => {
    expect(lookupOverride(overrides, 'Pool', 'liquidityRoot')).toBe('publicKey');
  });
  it('returns undefined when type or field missing', () => {
    expect(lookupOverride(overrides, 'Pool', 'missing')).toBeUndefined();
    expect(lookupOverride(overrides, 'Missing', 'authority')).toBeUndefined();
    expect(lookupOverride(undefined, 'Pool', 'authority')).toBeUndefined();
  });
});
