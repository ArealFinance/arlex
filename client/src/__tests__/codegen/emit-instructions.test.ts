import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { parseIdlJson } from '../../codegen/parser';
import { emitInstructionsSource } from '../../codegen/emit-instructions';

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('emitInstructionsSource — minimal IDL', () => {
  const idl = parseIdlJson(fixture('minimal.idl.json'));
  const src = emitInstructionsSource(idl);

  it('emits InitializeAccounts and InitializeArgs interfaces', () => {
    expect(src).toContain('export interface InitializeAccounts {');
    expect(src).toContain('export interface InitializeArgs {');
  });
  it('emits accounts as PublicKey-typed', () => {
    expect(src).toMatch(/config: PublicKey;/);
    expect(src).toMatch(/payer: PublicKey;/);
    expect(src).toMatch(/systemProgram: PublicKey;/);
  });
  it('emits encodeInitializeArgs function', () => {
    expect(src).toContain('export function encodeInitializeArgs(args: InitializeArgs): Buffer {');
  });
  it('emits no-args overload for noop instruction', () => {
    expect(src).toContain('export function encodeNoopArgs(): Buffer {');
    expect(src).not.toContain('export interface NoopArgs');
  });
  it('emits NoopAccounts interface (single signer)', () => {
    expect(src).toContain('export interface NoopAccounts {');
    expect(src).toMatch(/signer: PublicKey;/);
  });
  it('emits per-instruction discriminator', () => {
    expect(src).toContain('INITIALIZE_DISCRIMINATOR');
    expect(src).toContain('NOOP_DISCRIMINATOR');
  });
  it('emits explicit Buffer import for browser-bundle compatibility (G3 follow-up)', () => {
    // Required for Vite/Rollup which do NOT auto-polyfill the global Buffer.
    // Generated encode*Args helpers use Buffer.from / Buffer.concat below.
    expect(src).toContain("import { Buffer } from 'buffer';");
  });
});

describe('emitInstructionsSource — mixed IDL', () => {
  const idl = parseIdlJson(fixture('mixed.idl.json'));
  const src = emitInstructionsSource(idl);

  it('emits Entry struct (referenced from arg)', () => {
    expect(src).toContain('export interface Entry {');
  });
  it('correctly maps complex arg types', () => {
    expect(src).toContain('amount: bigint;');
    expect(src).toContain('small: number;');
    expect(src).toContain('wide: bigint;');
    expect(src).toContain('name: string;');
    expect(src).toContain('data: Uint8Array;');
    expect(src).toContain('values: number[];');
    expect(src).toContain('buf: Uint8Array;');
    expect(src).toContain('ownerAddress: PublicKey;');
    expect(src).toContain('merkleRoot: Bytes32;');
    expect(src).toContain('items: Entry[];');
    expect(src).toContain('maybeAmount: bigint | null;');
  });
  it('handles vec of [u8;32] as Bytes32[] (default heuristic — no ctx for inner)', () => {
    // The inner item lacks a fieldName so falls back to bytes32
    expect(src).toMatch(/tags: Bytes32\[\]|tags: Uint8Array/);
  });
  it('handles fixed array of [u8;32] as Bytes32[]', () => {
    expect(src).toMatch(/fixedPubkeys: (Bytes32|PublicKey)\[\]|fixedPubkeys: Uint8Array/);
  });
});
