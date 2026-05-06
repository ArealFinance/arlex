import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { parseIdlJson } from '../../codegen/parser';
import { emitErrorsSource } from '../../codegen/emit-errors';

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('emitErrorsSource — minimal IDL', () => {
  const idl = parseIdlJson(fixture('minimal.idl.json'));
  const src = emitErrorsSource(idl);

  it('emits ProgramErrorCode enum with declared codes', () => {
    expect(src).toContain('export enum ProgramErrorCode {');
    expect(src).toContain('InvalidAuthority = 6000,');
    expect(src).toContain('AlreadyInitialized = 6001,');
  });

  it('emits ProgramErrors array with all entries', () => {
    expect(src).toContain('export const ProgramErrors: IdlError[] = [');
    expect(src).toContain('{ code: 6000, name: "InvalidAuthority"');
    expect(src).toContain('{ code: 6001, name: "AlreadyInitialized"');
  });

  it('emits decodeProgramError function', () => {
    expect(src).toContain('export function decodeProgramError(input: number | unknown): ArlexProgramError | null {');
  });

  it('emits JSDoc comment with msg per error', () => {
    expect(src).toContain('The provided authority is not valid');
    expect(src).toContain('Config already initialized');
  });
});

describe('emitErrorsSource — empty errors', () => {
  const idlText = JSON.stringify({
    version: '0.1.0',
    name: 'noerr',
    instructions: [],
    accounts: [],
  });
  const idl = parseIdlJson(idlText);
  const src = emitErrorsSource(idl);

  it('emits empty enum', () => {
    expect(src).toContain('export enum ProgramErrorCode {}');
  });
  it('emits empty errors array', () => {
    expect(src).toContain('export const ProgramErrors: IdlError[] = [];');
  });
  it('still emits decodeProgramError', () => {
    expect(src).toContain('export function decodeProgramError(');
  });
});

describe('emitErrorsSource — sorts by code ascending', () => {
  const idlText = JSON.stringify({
    version: '0.1.0',
    name: 'sorted',
    instructions: [],
    accounts: [],
    errors: [
      { code: 6005, name: 'C', msg: 'c' },
      { code: 6001, name: 'A', msg: 'a' },
      { code: 6003, name: 'B', msg: 'b' },
    ],
  });
  const idl = parseIdlJson(idlText);
  const src = emitErrorsSource(idl);
  it('orders enum entries by code', () => {
    const aIdx = src.indexOf('A = 6001');
    const bIdx = src.indexOf('B = 6003');
    const cIdx = src.indexOf('C = 6005');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(cIdx).toBeGreaterThan(bIdx);
  });
});
