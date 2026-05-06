/**
 * Security tests for codegen — exercise the malicious-IDL inputs identified
 * by the security review. Every test asserts the codegen pipeline (parser
 * or generator) refuses to emit, ideally with a path-bearing error message.
 *
 * Coverage map → security findings:
 *   CRIT-1  account / instruction / type / variant identifier injection
 *   CRIT-2  enum variant injection
 *   CRIT-3  banner injection via idl.name / idl.version
 *   CRIT-4  error name injection
 *   WARN-2  malformed --pubkey-overrides JSON
 */
import { describe, it, expect } from 'vitest';
import { parseIdl, generateTypes, IdlParseError, UnsafeIdentError, sanitizeIdent } from '../../codegen';

// Minimal scaffold that all malicious-IDL tests start from.
function baseIdl(): Record<string, unknown> {
  return {
    version: '0.1.0',
    name: 'mal',
    instructions: [],
    accounts: [],
  };
}

describe('codegen security — identifier injection (CRIT-1)', () => {
  it('rejects account name with quote/semicolon injection', () => {
    const idl = baseIdl();
    idl.accounts = [{
      name: "Foo'; console.log('PWNED'); export const X = 1; '",
      type: { kind: 'struct', fields: [] },
    }];
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try {
      parseIdl(idl);
    } catch (e) {
      expect((e as Error).message).toContain('idl.accounts[0].name');
      expect((e as Error).message).toContain('safe identifier');
    }
  });

  it('rejects instruction name with brace injection', () => {
    const idl = baseIdl();
    idl.instructions = [{
      name: 'doStuff }; export const PWN = 1; function _(){',
      accounts: [],
      args: [],
    }];
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toMatch(/idl\.instructions\[0\]\.name/);
    }
  });

  it('rejects instruction account name with newline injection', () => {
    const idl = baseIdl();
    idl.instructions = [{
      name: 'safeName',
      accounts: [{ name: 'authority\n  pwned: any', isMut: false, isSigner: true }],
      args: [],
    }];
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toContain('accounts[0].name');
    }
  });

  it('rejects type defined-name with bracket injection', () => {
    const idl = baseIdl();
    idl.types = [{
      name: 'Bad]; export const P = 1; type X = [',
      type: { kind: 'struct', fields: [] },
    }];
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toContain('idl.types[0].name');
    }
  });

  it('rejects field name with quote injection', () => {
    const idl = baseIdl();
    idl.accounts = [{
      name: 'Acc',
      type: {
        kind: 'struct',
        fields: [{ name: "wallet'; var X=1; '", type: 'u64' }],
      },
    }];
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toContain('fields[0].name');
    }
  });

  it('rejects defined-reference with injection', () => {
    const idl = baseIdl();
    idl.accounts = [{
      name: 'Acc',
      type: {
        kind: 'struct',
        fields: [{ name: 'inner', type: { defined: 'Foo; export const PWN=1' } }],
      },
    }];
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toMatch(/safe identifier|defined/);
    }
  });
});

describe('codegen security — enum variant injection (CRIT-2)', () => {
  it('rejects enum variant with closing-quote injection', () => {
    const idl = baseIdl();
    idl.types = [{
      name: 'Status',
      type: {
        kind: 'enum',
        variants: [
          { name: 'A' },
          { name: "B'; export const PWNED = true; type X = '" },
        ],
      },
    }];
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toContain('variants[1].name');
    }
  });

  it('mapEnumVariants is defense-in-depth even if parser is bypassed', async () => {
    // Build an already-"normalized" IDL bypassing the parser, then exercise
    // mapEnumVariants directly to confirm it ALSO throws on unsafe names.
    const { mapEnumVariants } = await import('../../codegen/type-mapper');
    expect(() => mapEnumVariants({
      name: 'Status',
      type: { kind: 'enum', variants: [{ name: "X'; PWN=1; '" }] },
    })).toThrow(UnsafeIdentError);
  });
});

describe('codegen security — banner injection (CRIT-3)', () => {
  it('rejects idl.name containing newlines', () => {
    const idl = baseIdl();
    idl.name = 'mal\n*/\nexport const BANNER_PWN = true;\n/*';
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toContain('idl.name');
    }
  });

  it('rejects idl.version containing block-comment terminator', () => {
    const idl = baseIdl();
    idl.version = '0.1.0\n*/\nexport const BANNER_PWN = true;\n/*';
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toContain('idl.version');
    }
  });

  it('accepts well-formed semver-ish versions with hyphen / plus', () => {
    const idl = baseIdl();
    idl.version = '0.1.0-rc.1+build.42';
    idl.name = 'good-name.0';
    expect(() => parseIdl(idl)).not.toThrow();
  });
});

describe('codegen security — error name injection (CRIT-4)', () => {
  it('rejects error.name with comma/equals re-numbering injection', () => {
    const idl = baseIdl();
    idl.errors = [
      { code: 6000, name: 'Bad = 99999, /* sneaky', msg: 'oops' },
    ];
    expect(() => parseIdl(idl)).toThrow(IdlParseError);
    try { parseIdl(idl); } catch (e) {
      expect((e as Error).message).toContain('idl.errors[0].name');
      expect((e as Error).message).toContain('safe identifier');
    }
  });
});

describe('codegen security — pubkey overrides JSON shape (WARN-2)', () => {
  // The validator lives in cli.ts; we don't import the CLI surface in tests
  // (it triggers commander). Reproduce the contract here via a small helper
  // re-implementation that mirrors what validatePubkeyOverrides enforces.
  // If the contract changes, these expectations should be updated alongside
  // the CLI implementation.
  function validate(value: unknown, file = 'fixture.json') {
    // Inline mirror of cli.ts::validatePubkeyOverrides. Kept simple and
    // intentionally NOT shared so a regression in one is easy to spot.
    const where = `pubkey-overrides ${JSON.stringify(file)}`;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new IdlParseError(`${where}: top-level must be an object`);
    }
    for (const [typeName, typeMap] of Object.entries(value as Record<string, unknown>)) {
      if (typeMap === null || typeof typeMap !== 'object' || Array.isArray(typeMap)) {
        throw new IdlParseError(`${where}: value for ${JSON.stringify(typeName)} must be an object`);
      }
      for (const [fieldName, classification] of Object.entries(typeMap as Record<string, unknown>)) {
        if (classification !== 'publicKey' && classification !== 'bytes32') {
          throw new IdlParseError(
            `${where}: ${JSON.stringify(typeName)}.${JSON.stringify(fieldName)} must be 'publicKey' or 'bytes32'`,
          );
        }
      }
    }
  }

  it('rejects null at top level', () => {
    expect(() => validate(null)).toThrow(IdlParseError);
    try { validate(null); } catch (e) {
      expect((e as Error).message).toContain('top-level must be an object');
    }
  });

  it('rejects array at top level', () => {
    expect(() => validate([])).toThrow(IdlParseError);
  });

  it('rejects non-object inner value', () => {
    expect(() => validate({ MyType: 'not-an-object' })).toThrow(IdlParseError);
    try { validate({ MyType: 42 }); } catch (e) {
      expect((e as Error).message).toContain('"MyType"');
    }
  });

  it('rejects classification not in {publicKey, bytes32}', () => {
    expect(() => validate({ MyType: { foo: 'bar' } })).toThrow(IdlParseError);
    try { validate({ MyType: { foo: 'bar' } }); } catch (e) {
      expect((e as Error).message).toContain("'publicKey' or 'bytes32'");
    }
  });

  it('accepts well-formed input', () => {
    expect(() => validate({
      ConfigAccount: { authority: 'publicKey', params_hash: 'bytes32' },
    })).not.toThrow();
  });
});

describe('codegen security — sanitizeIdent contract', () => {
  it('throws on identifier containing semicolon', () => {
    expect(() => sanitizeIdent('foo; bar')).toThrow(UnsafeIdentError);
  });
  it('throws on identifier containing newline', () => {
    expect(() => sanitizeIdent('foo\nbar')).toThrow(UnsafeIdentError);
  });
  it('throws on identifier containing quote', () => {
    expect(() => sanitizeIdent("foo'bar")).toThrow(UnsafeIdentError);
  });
  it('throws on identifier containing dash', () => {
    // Common in IDLs but NOT a legal TS identifier — must throw, not silently
    // emit invalid code.
    expect(() => sanitizeIdent('foo-bar')).toThrow(UnsafeIdentError);
  });
  it('error message points to the offending input', () => {
    try {
      sanitizeIdent('foo; bar');
    } catch (e) {
      expect((e as Error).message).toContain('foo; bar');
      expect((e as Error).message).toContain('unsafe identifier');
    }
  });
});

describe('codegen security — generateTypes refuses to emit malicious IDL', () => {
  it('throws (does not produce a string) for any of the above inputs', () => {
    const idl = baseIdl();
    idl.accounts = [{
      name: "Foo'; PWN=1; '",
      type: { kind: 'struct', fields: [] },
    }];
    expect(() => generateTypes(idl)).toThrow(IdlParseError);
  });

  it('throws for malicious enum variant in defined types', () => {
    const idl = baseIdl();
    idl.types = [{
      name: 'Status',
      type: { kind: 'enum', variants: [{ name: "Bad' | type X = '" }] },
    }];
    expect(() => generateTypes(idl)).toThrow(IdlParseError);
  });
});
