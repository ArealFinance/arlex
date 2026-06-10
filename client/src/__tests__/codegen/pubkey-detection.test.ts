import { describe, it, expect } from 'vitest';
import {
  classifyBytesField,
  lookupOverride,
  collectPubkeyFieldNames,
  _PUBKEY_SUFFIXES,
  _NEGATIVE_TOKENS,
} from '../../codegen/pubkey-detection';
import type { IdlField } from '../../types';

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

describe('collectPubkeyFieldNames', () => {
  const fields: IdlField[] = [
    { name: 'authority', type: { array: ['u8', 32] } }, // pubkey by suffix
    { name: 'params_hash', type: { array: ['u8', 32] } }, // bytes32 (hash)
    { name: 'mint', type: { array: ['u8', 32] } }, // pubkey by suffix
    { name: 'amount', type: 'u64' }, // skipped — not [u8;32]
    { name: 'small_buf', type: { array: ['u8', 16] } }, // skipped — not 32 bytes
    { name: 'merkle_root', type: { array: ['u8', 32] } }, // bytes32 (root)
  ];

  it('returns only [u8;32] fields classified as publicKey, in declaration order', () => {
    const out = collectPubkeyFieldNames(fields, 'Pool');
    expect(out).toEqual(['authority', 'mint']);
  });

  it('skips non-[u8;32] fields entirely', () => {
    const out = collectPubkeyFieldNames(fields, 'Pool');
    expect(out).not.toContain('amount');
    expect(out).not.toContain('small_buf');
  });

  it('honors override: lifts a hash to publicKey', () => {
    const overrides = { Pool: { params_hash: 'publicKey' as const } };
    const out = collectPubkeyFieldNames(fields, 'Pool', overrides);
    expect(out).toContain('params_hash');
  });

  it('honors override: demotes an authority to bytes32', () => {
    const overrides = { Pool: { authority: 'bytes32' as const } };
    const out = collectPubkeyFieldNames(fields, 'Pool', overrides);
    expect(out).not.toContain('authority');
    expect(out).toContain('mint'); // still pubkey via heuristic
  });

  it('returns empty list when no fields match', () => {
    expect(collectPubkeyFieldNames([], 'Anything')).toEqual([]);
    expect(
      collectPubkeyFieldNames(
        [{ name: 'amount', type: 'u64' }, { name: 'flag', type: 'bool' }],
        'X',
      ),
    ).toEqual([]);
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
