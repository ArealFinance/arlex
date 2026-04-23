import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { serializeArgs, deserializeAccount, buildTypeRegistry } from '../serialization';
import type { IdlField, IdlTypeDef } from '../types';

// Helper: serialize then deserialize (roundtrip)
function roundtrip(fields: IdlField[], values: Record<string, any>, registry?: ReturnType<typeof buildTypeRegistry>) {
  const buf = serializeArgs(fields, values, registry);
  // Prepend 8-byte fake discriminator for deserializeAccount
  const withDisc = Buffer.concat([Buffer.alloc(8), buf]);
  return deserializeAccount(fields, withDisc, registry);
}

describe('serialization', () => {
  // ==================== Primitives ====================

  describe('primitives roundtrip', () => {
    const cases: [string, string, any][] = [
      ['u8', 'u8', 42],
      ['u8 zero', 'u8', 0],
      ['u8 max', 'u8', 255],
      ['i8 positive', 'i8', 127],
      ['i8 negative', 'i8', -128],
      ['u16', 'u16', 1000],
      ['i16 negative', 'i16', -500],
      ['u32', 'u32', 1_000_000],
      ['i32 negative', 'i32', -999],
      ['u64', 'u64', BigInt('18446744073709551615')], // u64 max
      ['u64 zero', 'u64', BigInt(0)],
      ['i64 positive', 'i64', BigInt('9223372036854775807')], // i64 max
      ['i64 negative', 'i64', BigInt('-9223372036854775808')], // i64 min
      ['bool true', 'bool', true],
      ['bool false', 'bool', false],
      ['f32', 'f32', 3.14],
      ['f64', 'f64', 2.718281828],
    ];

    for (const [name, type, value] of cases) {
      it(name, () => {
        const fields: IdlField[] = [{ name: 'val', type }];
        const result = roundtrip(fields, { val: value });
        if (type === 'f32') {
          expect(Math.abs(result.val - value)).toBeLessThan(0.001);
        } else if (typeof value === 'bigint') {
          expect(result.val).toBe(value);
        } else {
          expect(result.val).toBe(value);
        }
      });
    }
  });

  describe('u128/i128', () => {
    it('u128 roundtrip', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'u128' }];
      const big = BigInt('340282366920938463463374607431768211455'); // u128 max
      const result = roundtrip(fields, { val: big });
      expect(result.val).toBe(big);
    });

    it('u128 zero', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'u128' }];
      const result = roundtrip(fields, { val: BigInt(0) });
      expect(result.val).toBe(BigInt(0));
    });

    it('i128 negative', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'i128' }];
      const result = roundtrip(fields, { val: BigInt(-1) });
      expect(result.val).toBe(BigInt(-1));
    });

    it('i128 large negative', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'i128' }];
      const val = BigInt('-170141183460469231731687303715884105728'); // i128 min
      const result = roundtrip(fields, { val });
      expect(result.val).toBe(val);
    });
  });

  // ==================== PublicKey ====================

  describe('publicKey', () => {
    it('roundtrip with PublicKey object', () => {
      const pk = PublicKey.unique();
      const fields: IdlField[] = [{ name: 'key', type: 'publicKey' }];
      const result = roundtrip(fields, { key: pk });
      expect(result.key.toBase58()).toBe(pk.toBase58());
    });

    it('roundtrip with base58 string', () => {
      const addr = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
      const fields: IdlField[] = [{ name: 'key', type: 'publicKey' }];
      const buf = serializeArgs(fields, { key: addr });
      expect(buf.length).toBe(32);
    });
  });

  // ==================== String ====================

  describe('string', () => {
    it('normal string', () => {
      const fields: IdlField[] = [{ name: 'name', type: 'string' }];
      const result = roundtrip(fields, { name: 'hello world' });
      expect(result.name).toBe('hello world');
    });

    it('empty string', () => {
      const fields: IdlField[] = [{ name: 'name', type: 'string' }];
      const result = roundtrip(fields, { name: '' });
      expect(result.name).toBe('');
    });

    it('unicode', () => {
      const fields: IdlField[] = [{ name: 'name', type: 'string' }];
      const result = roundtrip(fields, { name: 'Привет мир 🌍' });
      expect(result.name).toBe('Привет мир 🌍');
    });
  });

  // ==================== Array ====================

  describe('array', () => {
    it('[u8; 32] from Buffer', () => {
      const fields: IdlField[] = [{ name: 'data', type: { array: ['u8', 32] } }];
      const input = Buffer.alloc(32, 0xAB);
      const result = roundtrip(fields, { data: input });
      expect(Buffer.from(result.data)).toEqual(input);
    });

    it('[u8; 32] from array', () => {
      const fields: IdlField[] = [{ name: 'data', type: { array: ['u8', 4] } }];
      const result = roundtrip(fields, { data: [1, 2, 3, 4] });
      expect([...result.data]).toEqual([1, 2, 3, 4]);
    });

    it('[u64; 3] typed array', () => {
      const fields: IdlField[] = [{ name: 'vals', type: { array: ['u64', 3] } }];
      const result = roundtrip(fields, { vals: [BigInt(1), BigInt(2), BigInt(3)] });
      expect(result.vals).toEqual([BigInt(1), BigInt(2), BigInt(3)]);
    });
  });

  // ==================== Vec ====================

  describe('vec', () => {
    it('empty vec', () => {
      const fields: IdlField[] = [{ name: 'items', type: { vec: 'u32' } }];
      const result = roundtrip(fields, { items: [] });
      expect(result.items).toEqual([]);
    });

    it('vec of u64', () => {
      const fields: IdlField[] = [{ name: 'items', type: { vec: 'u64' } }];
      const items = [BigInt(10), BigInt(20), BigInt(30)];
      const result = roundtrip(fields, { items });
      expect(result.items).toEqual(items);
    });

    it('vec of publicKey', () => {
      const fields: IdlField[] = [{ name: 'keys', type: { vec: 'publicKey' } }];
      const keys = [PublicKey.unique(), PublicKey.unique()];
      const result = roundtrip(fields, { keys });
      expect(result.keys[0].toBase58()).toBe(keys[0].toBase58());
      expect(result.keys[1].toBase58()).toBe(keys[1].toBase58());
    });
  });

  // ==================== Option ====================

  describe('option', () => {
    it('Some value', () => {
      const fields: IdlField[] = [{ name: 'val', type: { option: 'u64' } }];
      const result = roundtrip(fields, { val: BigInt(42) });
      expect(result.val).toBe(BigInt(42));
    });

    it('None (null)', () => {
      const fields: IdlField[] = [{ name: 'val', type: { option: 'u64' } }];
      const result = roundtrip(fields, { val: null });
      expect(result.val).toBeNull();
    });

    it('None (undefined)', () => {
      const fields: IdlField[] = [{ name: 'val', type: { option: 'u64' } }];
      const result = roundtrip(fields, { val: undefined });
      expect(result.val).toBeNull();
    });
  });

  // ==================== Defined types ====================

  describe('defined types', () => {
    const types: IdlTypeDef[] = [
      {
        name: 'StakeInfo',
        type: {
          kind: 'struct',
          fields: [
            { name: 'amount', type: 'u64' },
            { name: 'timestamp', type: 'i64' },
          ],
        },
      },
      {
        name: 'Status',
        type: {
          kind: 'enum',
          variants: [{ name: 'Active' }, { name: 'Paused' }, { name: 'Closed' }],
        },
      },
    ];

    const registry = buildTypeRegistry(types);

    it('struct roundtrip', () => {
      const fields: IdlField[] = [{ name: 'info', type: { defined: 'StakeInfo' } }];
      const value = { amount: BigInt(1000), timestamp: BigInt(1234567890) };
      const result = roundtrip(fields, { info: value }, registry);
      expect(result.info.amount).toBe(BigInt(1000));
      expect(result.info.timestamp).toBe(BigInt(1234567890));
    });

    it('enum roundtrip', () => {
      const fields: IdlField[] = [{ name: 'status', type: { defined: 'Status' } }];
      const result = roundtrip(fields, { status: 'Paused' }, registry);
      expect(result.status).toBe('Paused');
    });

    it('enum variant index 0', () => {
      const fields: IdlField[] = [{ name: 'status', type: { defined: 'Status' } }];
      const result = roundtrip(fields, { status: 'Active' }, registry);
      expect(result.status).toBe('Active');
    });

    it('unknown defined type throws', () => {
      const fields: IdlField[] = [{ name: 'x', type: { defined: 'Unknown' } }];
      expect(() => roundtrip(fields, { x: {} }, registry)).toThrow('Unknown defined type');
    });

    it('unknown enum variant throws', () => {
      const fields: IdlField[] = [{ name: 'status', type: { defined: 'Status' } }];
      expect(() => roundtrip(fields, { status: 'Invalid' }, registry)).toThrow('Unknown variant');
    });

    it('no registry throws', () => {
      const fields: IdlField[] = [{ name: 'x', type: { defined: 'StakeInfo' } }];
      expect(() => roundtrip(fields, { x: {} })).toThrow('No type registry');
    });
  });

  // ==================== Multi-field ====================

  describe('multi-field', () => {
    it('multiple fields in sequence', () => {
      const fields: IdlField[] = [
        { name: 'authority', type: 'publicKey' },
        { name: 'count', type: 'u64' },
        { name: 'active', type: 'bool' },
      ];
      const pk = PublicKey.unique();
      const result = roundtrip(fields, { authority: pk, count: BigInt(99), active: true });
      expect(result.authority.toBase58()).toBe(pk.toBase58());
      expect(result.count).toBe(BigInt(99));
      expect(result.active).toBe(true);
    });
  });

  // ==================== Error cases ====================

  describe('error cases', () => {
    it('missing arg throws', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'u64' }];
      expect(() => serializeArgs(fields, {})).toThrow('Missing arg: val');
    });

    it('short buffer throws', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'u64' }];
      const shortBuf = Buffer.alloc(12); // 8 disc + 4 data (need 8)
      expect(() => deserializeAccount(fields, shortBuf)).toThrow('Buffer too short');
    });

    it('very short buffer (< 8 discriminator) throws', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'u8' }];
      expect(() => deserializeAccount(fields, Buffer.alloc(4))).toThrow('too short');
    });

    it('vec with insane length throws', () => {
      const fields: IdlField[] = [{ name: 'items', type: { vec: 'u8' } }];
      const buf = Buffer.alloc(8 + 4);
      buf.writeUInt32LE(0xFFFFFFFF, 8); // 4 billion items
      expect(() => deserializeAccount(fields, buf)).toThrow('Vec too long');
    });

    it('string with insane length throws', () => {
      const fields: IdlField[] = [{ name: 'name', type: 'string' }];
      const buf = Buffer.alloc(8 + 4);
      buf.writeUInt32LE(0xFFFFFFFF, 8);
      expect(() => deserializeAccount(fields, buf)).toThrow('too long');
    });

    it('bytes with insane length throws', () => {
      const fields: IdlField[] = [{ name: 'data', type: 'bytes' }];
      const buf = Buffer.alloc(8 + 4);
      buf.writeUInt32LE(0xFFFFFFFF, 8);
      expect(() => deserializeAccount(fields, buf)).toThrow('too long');
    });

    it('malformed option tag (tag=2) reads value anyway', () => {
      // option tag should be 0 or 1, tag=2 is treated as Some
      const fields: IdlField[] = [{ name: 'val', type: { option: 'u8' } }];
      const buf = Buffer.alloc(8 + 2);
      buf[8] = 2; // invalid tag
      buf[9] = 42;
      const result = deserializeAccount(fields, buf);
      // Non-zero tag is treated as Some — this is consistent with Borsh behavior
      expect(result.val).toBe(42);
    });

    it('enum variant index out of bounds throws', () => {
      const types: IdlTypeDef[] = [{
        name: 'Color',
        type: { kind: 'enum', variants: [{ name: 'Red' }, { name: 'Blue' }] },
      }];
      const reg = buildTypeRegistry(types);
      const fields: IdlField[] = [{ name: 'color', type: { defined: 'Color' } }];
      const buf = Buffer.alloc(8 + 1);
      buf[8] = 99; // out of bounds variant
      expect(() => deserializeAccount(fields, buf, reg)).toThrow('Unknown variant index');
    });
  });

  // ==================== Bytes type ====================

  describe('bytes', () => {
    it('roundtrip normal bytes', () => {
      const fields: IdlField[] = [{ name: 'data', type: 'bytes' }];
      const input = Buffer.from([1, 2, 3, 4, 5]);
      const buf = serializeArgs(fields, { data: input });
      const withDisc = Buffer.concat([Buffer.alloc(8), buf]);
      const result = deserializeAccount(fields, withDisc);
      expect(Buffer.from(result.data)).toEqual(input);
    });

    it('empty bytes', () => {
      const fields: IdlField[] = [{ name: 'data', type: 'bytes' }];
      const buf = serializeArgs(fields, { data: Buffer.alloc(0) });
      const withDisc = Buffer.concat([Buffer.alloc(8), buf]);
      const result = deserializeAccount(fields, withDisc);
      expect(result.data.length).toBe(0);
    });

    it('bytes from array', () => {
      const fields: IdlField[] = [{ name: 'data', type: 'bytes' }];
      const buf = serializeArgs(fields, { data: [0xDE, 0xAD, 0xBE, 0xEF] });
      expect(buf.length).toBe(4 + 4); // 4 len prefix + 4 bytes
    });
  });

  // ==================== Nested composite types ====================

  describe('nested composites', () => {
    const types: IdlTypeDef[] = [
      {
        name: 'Position',
        type: {
          kind: 'struct',
          fields: [
            { name: 'pool', type: 'publicKey' },
            { name: 'amount', type: 'u64' },
          ],
        },
      },
      {
        name: 'OrderType',
        type: {
          kind: 'enum',
          variants: [{ name: 'Buy' }, { name: 'Sell' }, { name: 'Limit' }],
        },
      },
    ];
    const registry = buildTypeRegistry(types);

    it('vec of structs', () => {
      const fields: IdlField[] = [{ name: 'positions', type: { vec: { defined: 'Position' } } }];
      const pk1 = PublicKey.unique();
      const pk2 = PublicKey.unique();
      const value = [
        { pool: pk1, amount: BigInt(100) },
        { pool: pk2, amount: BigInt(200) },
      ];
      const result = roundtrip(fields, { positions: value }, registry);
      expect(result.positions.length).toBe(2);
      expect(result.positions[0].pool.toBase58()).toBe(pk1.toBase58());
      expect(result.positions[0].amount).toBe(BigInt(100));
      expect(result.positions[1].amount).toBe(BigInt(200));
    });

    it('option of struct', () => {
      const fields: IdlField[] = [{ name: 'pos', type: { option: { defined: 'Position' } } }];
      const pk = PublicKey.unique();
      const result = roundtrip(fields, { pos: { pool: pk, amount: BigInt(50) } }, registry);
      expect(result.pos.pool.toBase58()).toBe(pk.toBase58());
      expect(result.pos.amount).toBe(BigInt(50));
    });

    it('option of struct None', () => {
      const fields: IdlField[] = [{ name: 'pos', type: { option: { defined: 'Position' } } }];
      const result = roundtrip(fields, { pos: null }, registry);
      expect(result.pos).toBeNull();
    });

    it('vec of enums', () => {
      const fields: IdlField[] = [{ name: 'orders', type: { vec: { defined: 'OrderType' } } }];
      const result = roundtrip(fields, { orders: ['Buy', 'Sell', 'Limit'] }, registry);
      expect(result.orders).toEqual(['Buy', 'Sell', 'Limit']);
    });

    it('struct with enum field', () => {
      const extraTypes: IdlTypeDef[] = [
        ...types,
        {
          name: 'Order',
          type: {
            kind: 'struct',
            fields: [
              { name: 'side', type: { defined: 'OrderType' } },
              { name: 'amount', type: 'u64' },
            ],
          },
        },
      ];
      const reg = buildTypeRegistry(extraTypes);
      const fields: IdlField[] = [{ name: 'order', type: { defined: 'Order' } }];
      const result = roundtrip(fields, { order: { side: 'Buy', amount: BigInt(500) } }, reg);
      expect(result.order.side).toBe('Buy');
      expect(result.order.amount).toBe(BigInt(500));
    });
  });

  // ==================== Boundary values for u16/u32 ====================

  describe('boundary values', () => {
    it('u16 max (65535)', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'u16' }];
      const result = roundtrip(fields, { val: 65535 });
      expect(result.val).toBe(65535);
    });

    it('i16 min (-32768)', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'i16' }];
      const result = roundtrip(fields, { val: -32768 });
      expect(result.val).toBe(-32768);
    });

    it('u32 max (4294967295)', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'u32' }];
      const result = roundtrip(fields, { val: 4294967295 });
      expect(result.val).toBe(4294967295);
    });

    it('i32 min (-2147483648)', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'i32' }];
      const result = roundtrip(fields, { val: -2147483648 });
      expect(result.val).toBe(-2147483648);
    });
  });

  // ==================== f32/f64 special values ====================

  describe('float special values', () => {
    it('f64 NaN roundtrip', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'f64' }];
      const result = roundtrip(fields, { val: NaN });
      expect(result.val).toBeNaN();
    });

    it('f64 Infinity', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'f64' }];
      const result = roundtrip(fields, { val: Infinity });
      expect(result.val).toBe(Infinity);
    });

    it('f64 -Infinity', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'f64' }];
      const result = roundtrip(fields, { val: -Infinity });
      expect(result.val).toBe(-Infinity);
    });

    it('f64 negative zero', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'f64' }];
      const result = roundtrip(fields, { val: -0 });
      expect(Object.is(result.val, -0)).toBe(true);
    });

    it('f32 NaN roundtrip', () => {
      const fields: IdlField[] = [{ name: 'val', type: 'f32' }];
      const result = roundtrip(fields, { val: NaN });
      expect(result.val).toBeNaN();
    });
  });
});
