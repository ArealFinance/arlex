import { describe, it, expect } from 'vitest';
import type { IdlType, IdlTypeDef } from '../../types';
import { mapIdlType, mapEnumVariants, UnsupportedTypeError } from '../../codegen/type-mapper';

const emptyRegistry = new Map<string, IdlTypeDef>();

function map(type: IdlType, fieldName = 'val', outerTypeName = 'Foo') {
  return mapIdlType(type, { registry: emptyRegistry, fieldName, outerTypeName });
}

describe('mapIdlType — primitives', () => {
  const cases: [IdlType, string][] = [
    ['u8', 'number'],
    ['i8', 'number'],
    ['u16', 'number'],
    ['i16', 'number'],
    ['u32', 'number'],
    ['i32', 'number'],
    ['f32', 'number'],
    ['f64', 'number'],
    ['u64', 'bigint'],
    ['i64', 'bigint'],
    ['u128', 'bigint'],
    ['i128', 'bigint'],
    ['bool', 'boolean'],
    ['string', 'string'],
    ['bytes', 'Uint8Array'],
    ['publicKey', 'PublicKey'],
  ];
  for (const [type, ts] of cases) {
    it(`${JSON.stringify(type)} → ${ts}`, () => {
      expect(map(type)).toBe(ts);
    });
  }
  it('throws on unknown primitive', () => {
    expect(() => map('weird' as IdlType)).toThrow(UnsupportedTypeError);
  });
});

describe('mapIdlType — vec / option / array', () => {
  it('vec<u64> → bigint[]', () => {
    expect(map({ vec: 'u64' })).toBe('bigint[]');
  });
  it('option<u8> → number | null', () => {
    expect(map({ option: 'u8' })).toBe('number | null');
  });
  it('vec<option<u32>> wraps union with parens', () => {
    expect(map({ vec: { option: 'u32' } })).toBe('(number | null)[]');
  });
  it('[u64; 4] → bigint[]', () => {
    expect(map({ array: ['u64', 4] })).toBe('bigint[]');
  });
});

describe('mapIdlType — [u8; 32] heuristic', () => {
  it('authority → PublicKey', () => {
    expect(map({ array: ['u8', 32] }, 'authority')).toBe('PublicKey');
  });
  it('params_hash → Bytes32', () => {
    expect(map({ array: ['u8', 32] }, 'params_hash')).toBe('Bytes32');
  });
  it('non-32 [u8; N] → Uint8Array', () => {
    expect(map({ array: ['u8', 200] }, 'authority')).toBe('Uint8Array');
    expect(map({ array: ['u8', 10] }, 'mint')).toBe('Uint8Array');
  });
  it('override wins', () => {
    const result = mapIdlType(
      { array: ['u8', 32] },
      {
        registry: emptyRegistry,
        fieldName: 'params_hash',
        outerTypeName: 'Foo',
        overrides: { Foo: { params_hash: 'publicKey' } },
      },
    );
    expect(result).toBe('PublicKey');
  });
});

describe('mapIdlType — defined references', () => {
  it('struct reference → PascalCase type name', () => {
    const reg = new Map<string, IdlTypeDef>([
      ['MyStruct', { name: 'MyStruct', type: { kind: 'struct', fields: [] } }],
    ]);
    expect(mapIdlType({ defined: 'MyStruct' }, { registry: reg, fieldName: 'val', outerTypeName: 'Outer' }))
      .toBe('MyStruct');
  });

  it('snake_case defined name is PascalCased', () => {
    const reg = new Map<string, IdlTypeDef>([
      ['my_struct', { name: 'my_struct', type: { kind: 'struct', fields: [] } }],
    ]);
    expect(mapIdlType({ defined: 'my_struct' }, { registry: reg, fieldName: 'val', outerTypeName: 'Outer' }))
      .toBe('MyStruct');
  });

  it('tag-only enum → still emits PascalCase name (use mapEnumVariants for body)', () => {
    const reg = new Map<string, IdlTypeDef>([
      ['Status', { name: 'Status', type: { kind: 'enum', variants: [{ name: 'A' }, { name: 'B' }] } }],
    ]);
    expect(mapIdlType({ defined: 'Status' }, { registry: reg, fieldName: 'val', outerTypeName: 'Outer' }))
      .toBe('Status');
  });

  it('throws on enum with data variants', () => {
    const reg = new Map<string, IdlTypeDef>([
      ['Bad', {
        name: 'Bad',
        type: {
          kind: 'enum',
          // simulate variant with fields by writing the cast — type system is permissive
          variants: [{ name: 'A', fields: [{ name: 'x', type: 'u8' }] } as any],
        },
      }],
    ]);
    expect(() => mapIdlType({ defined: 'Bad' }, { registry: reg, fieldName: 'val', outerTypeName: 'Outer' }))
      .toThrow(UnsupportedTypeError);
  });
});

describe('mapEnumVariants', () => {
  it('emits string-literal union', () => {
    const def: IdlTypeDef = {
      name: 'Status',
      type: { kind: 'enum', variants: [{ name: 'Active' }, { name: 'Paused' }, { name: 'Closed' }] },
    };
    expect(mapEnumVariants(def)).toBe("'Active' | 'Paused' | 'Closed'");
  });
  it('returns "never" for empty enum', () => {
    const def: IdlTypeDef = { name: 'Empty', type: { kind: 'enum', variants: [] } };
    expect(mapEnumVariants(def)).toBe('never');
  });
  it('throws on non-enum', () => {
    const def: IdlTypeDef = { name: 'NotEnum', type: { kind: 'struct', fields: [] } };
    expect(() => mapEnumVariants(def)).toThrow(UnsupportedTypeError);
  });
  it('throws on enum-with-data', () => {
    const def: IdlTypeDef = {
      name: 'Bad',
      type: { kind: 'enum', variants: [{ name: 'A', fields: [{ name: 'x', type: 'u8' }] } as any] },
    };
    expect(() => mapEnumVariants(def)).toThrow(UnsupportedTypeError);
  });
});
