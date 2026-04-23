import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { instructionDiscriminator, accountDiscriminator, eventDiscriminator } from '../discriminator';

describe('discriminator', () => {
  describe('instructionDiscriminator', () => {
    it('computes sha256("global:<name>")[0..8]', () => {
      const expected = createHash('sha256').update('global:initialize').digest().subarray(0, 8);
      expect(instructionDiscriminator('initialize')).toEqual(expected);
    });

    it('returns 8 bytes', () => {
      expect(instructionDiscriminator('transfer').length).toBe(8);
    });

    it('is deterministic', () => {
      const a = instructionDiscriminator('mint_ot');
      const b = instructionDiscriminator('mint_ot');
      expect(a).toEqual(b);
    });

    it('different names produce different discriminators', () => {
      const a = instructionDiscriminator('initialize');
      const b = instructionDiscriminator('increment');
      expect(a).not.toEqual(b);
    });

    // Known Anchor values — verified against anchor-cli
    it('matches Anchor for "initialize"', () => {
      const disc = instructionDiscriminator('initialize');
      const hex = disc.toString('hex');
      // sha256("global:initialize") = af af 6d 1f 0d 98 9b ed ...
      expect(hex).toBe('afaf6d1f0d989bed');
    });
  });

  describe('accountDiscriminator', () => {
    it('computes sha256("account:<Name>")[0..8]', () => {
      const expected = createHash('sha256').update('account:Counter').digest().subarray(0, 8);
      expect(accountDiscriminator('Counter')).toEqual(expected);
    });

    it('returns 8 bytes', () => {
      expect(accountDiscriminator('Vault').length).toBe(8);
    });

    it('is case-sensitive (PascalCase)', () => {
      const a = accountDiscriminator('Counter');
      const b = accountDiscriminator('counter');
      expect(a).not.toEqual(b);
    });
  });

  describe('eventDiscriminator', () => {
    it('computes sha256("event:<Name>")[0..8]', () => {
      const expected = createHash('sha256').update('event:Transfer').digest().subarray(0, 8);
      expect(eventDiscriminator('Transfer')).toEqual(expected);
    });

    it('returns 8 bytes', () => {
      expect(eventDiscriminator('Deposited').length).toBe(8);
    });
  });
});
