import { createHash } from 'crypto';

/**
 * Compute 8-byte discriminator — Anchor-compatible.
 * For instructions: sha256("global:<name>")[0..8]
 * For accounts: sha256("account:<Name>")[0..8]
 * For events: sha256("event:<Name>")[0..8]
 */
export function instructionDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

export function accountDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
}

export function eventDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
}
