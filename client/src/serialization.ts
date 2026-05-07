import { PublicKey } from '@solana/web3.js';
import type { IdlType, IdlField, IdlTypeDef } from './types';

// Max sane vec length to prevent OOM (1 MB worth of u8)
const MAX_VEC_LEN = 1_048_576;

/**
 * Type registry for resolving `{ defined: "TypeName" }` references.
 * Populated from IDL `types[]` and `accounts[]`.
 */
export type TypeRegistry = Map<string, IdlTypeDef>;

export function buildTypeRegistry(types?: IdlTypeDef[], accounts?: { name: string; type: { kind: string; fields: IdlField[] } }[]): TypeRegistry {
  const registry: TypeRegistry = new Map();
  if (types) {
    for (const t of types) registry.set(t.name, t);
  }
  if (accounts) {
    for (const a of accounts) {
      registry.set(a.name, { name: a.name, type: a.type });
    }
  }
  return registry;
}

/**
 * Serialize instruction args to Buffer
 */
export function serializeArgs(fields: IdlField[], values: Record<string, any>, registry?: TypeRegistry): Buffer {
  const buffers: Buffer[] = [];
  for (const field of fields) {
    const val = values[field.name];
    // undefined is allowed for option types (treated as None)
    const isOption = typeof field.type === 'object' && 'option' in field.type;
    if (val === undefined && !isOption) throw new Error(`Missing arg: ${field.name}`);
    buffers.push(serializeType(field.type, val, registry));
  }
  return Buffer.concat(buffers);
}

function serializeType(type: IdlType, value: any, registry?: TypeRegistry): Buffer {
  if (typeof type === 'string') {
    switch (type) {
      case 'u8': { const b = Buffer.alloc(1); b.writeUInt8(value); return b; }
      case 'i8': { const b = Buffer.alloc(1); b.writeInt8(value); return b; }
      case 'u16': { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
      case 'i16': { const b = Buffer.alloc(2); b.writeInt16LE(value); return b; }
      case 'u32': { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
      case 'i32': { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; }
      case 'u64': { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
      case 'i64': { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(value)); return b; }
      case 'u128': {
        const n = BigInt(value);
        const b = Buffer.alloc(16);
        b.writeBigUInt64LE(n & BigInt('0xFFFFFFFFFFFFFFFF'), 0);
        b.writeBigUInt64LE(n >> BigInt(64), 8);
        return b;
      }
      case 'i128': {
        const n = BigInt(value);
        const b = Buffer.alloc(16);
        b.writeBigUInt64LE(n & BigInt('0xFFFFFFFFFFFFFFFF'), 0);
        b.writeBigInt64LE(n >> BigInt(64), 8);
        return b;
      }
      case 'f32': { const b = Buffer.alloc(4); b.writeFloatLE(value); return b; }
      case 'f64': { const b = Buffer.alloc(8); b.writeDoubleLE(value); return b; }
      case 'bool': return Buffer.from([value ? 1 : 0]);
      case 'publicKey': {
        const pk = value instanceof PublicKey ? value : new PublicKey(value);
        return pk.toBuffer();
      }
      case 'string': {
        const strBuf = Buffer.from(value, 'utf8');
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32LE(strBuf.length);
        return Buffer.concat([lenBuf, strBuf]);
      }
      case 'bytes': {
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32LE(bytes.length);
        return Buffer.concat([lenBuf, bytes]);
      }
      default: throw new Error(`Unknown primitive type: ${type}`);
    }
  }

  if ('array' in type) {
    const [itemType, size] = type.array;
    if (itemType === 'u8') {
      // Accept Buffer / Uint8Array / number[] / PublicKey (pubkey-classified
      // [u8;32] fields). PublicKey first so its `.toBuffer()` is preferred
      // over the iterable-array fallback.
      if (value instanceof PublicKey) {
        const result = Buffer.alloc(size);
        value.toBuffer().copy(result, 0, 0, Math.min(32, size));
        return result;
      }
      if (Buffer.isBuffer(value) || value instanceof Uint8Array || Array.isArray(value)) {
        const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const result = Buffer.alloc(size);
        buf.copy(result, 0, 0, Math.min(buf.length, size));
        return result;
      }
    }
    const bufs = [];
    for (let i = 0; i < size; i++) bufs.push(serializeType(itemType, value[i], registry));
    return Buffer.concat(bufs);
  }

  if ('vec' in type) {
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(value.length);
    const items = value.map((v: any) => serializeType(type.vec, v, registry));
    return Buffer.concat([lenBuf, ...items]);
  }

  if ('option' in type) {
    if (value === null || value === undefined) return Buffer.from([0]);
    return Buffer.concat([Buffer.from([1]), serializeType(type.option, value, registry)]);
  }

  // Defined type — resolve from registry
  if ('defined' in type) {
    if (!registry) throw new Error(`No type registry for defined type: ${type.defined}`);
    const typeDef = registry.get(type.defined);
    if (!typeDef) throw new Error(`Unknown defined type: ${type.defined}`);

    if (typeDef.type.kind === 'struct' && typeDef.type.fields) {
      const bufs = [];
      for (const field of typeDef.type.fields) {
        const val = value[field.name];
        if (val === undefined) throw new Error(`Missing field '${field.name}' for type '${type.defined}'`);
        bufs.push(serializeType(field.type, val, registry));
      }
      return Buffer.concat(bufs);
    }

    if (typeDef.type.kind === 'enum' && typeDef.type.variants) {
      // Enum serialized as u8 variant index
      const variantName = typeof value === 'string' ? value : value?.variant;
      const idx = typeDef.type.variants.findIndex(v => v.name === variantName);
      if (idx === -1) throw new Error(`Unknown variant '${variantName}' for enum '${type.defined}'`);
      return Buffer.from([idx]);
    }

    throw new Error(`Unsupported defined type kind: ${typeDef.type.kind}`);
  }

  throw new Error(`Cannot serialize type: ${JSON.stringify(type)}`);
}

/**
 * Deserialize account data from Buffer (skip 8-byte discriminator)
 */
export function deserializeAccount(fields: IdlField[], data: Buffer, registry?: TypeRegistry): Record<string, any> {
  if (data.length < 8) throw new Error(`Account data too short: ${data.length} bytes (need at least 8)`);

  let offset = 8; // skip discriminator
  const result: Record<string, any> = {};

  for (const field of fields) {
    if (offset >= data.length) throw new Error(`Buffer exhausted at field '${field.name}' (offset ${offset}, length ${data.length})`);
    const { value, bytesRead } = deserializeType(field.type, data, offset, registry);
    result[field.name] = value;
    offset += bytesRead;
  }

  return result;
}

function ensureBytes(data: Buffer, offset: number, need: number, context: string) {
  if (offset + need > data.length) {
    throw new Error(`Buffer too short for ${context}: need ${need} bytes at offset ${offset}, have ${data.length}`);
  }
}

function deserializeType(type: IdlType, data: Buffer, offset: number, registry?: TypeRegistry): { value: any; bytesRead: number } {
  if (typeof type === 'string') {
    switch (type) {
      case 'u8': ensureBytes(data, offset, 1, 'u8'); return { value: data.readUInt8(offset), bytesRead: 1 };
      case 'i8': ensureBytes(data, offset, 1, 'i8'); return { value: data.readInt8(offset), bytesRead: 1 };
      case 'u16': ensureBytes(data, offset, 2, 'u16'); return { value: data.readUInt16LE(offset), bytesRead: 2 };
      case 'i16': ensureBytes(data, offset, 2, 'i16'); return { value: data.readInt16LE(offset), bytesRead: 2 };
      case 'u32': ensureBytes(data, offset, 4, 'u32'); return { value: data.readUInt32LE(offset), bytesRead: 4 };
      case 'i32': ensureBytes(data, offset, 4, 'i32'); return { value: data.readInt32LE(offset), bytesRead: 4 };
      case 'u64': ensureBytes(data, offset, 8, 'u64'); return { value: data.readBigUInt64LE(offset), bytesRead: 8 };
      case 'i64': ensureBytes(data, offset, 8, 'i64'); return { value: data.readBigInt64LE(offset), bytesRead: 8 };
      case 'u128': {
        ensureBytes(data, offset, 16, 'u128');
        const lo = data.readBigUInt64LE(offset);
        const hi = data.readBigUInt64LE(offset + 8);
        return { value: (hi << BigInt(64)) | lo, bytesRead: 16 };
      }
      case 'i128': {
        ensureBytes(data, offset, 16, 'i128');
        const lo = data.readBigUInt64LE(offset);
        const hi = data.readBigInt64LE(offset + 8);
        return { value: (hi << BigInt(64)) | lo, bytesRead: 16 };
      }
      case 'f32': ensureBytes(data, offset, 4, 'f32'); return { value: data.readFloatLE(offset), bytesRead: 4 };
      case 'f64': ensureBytes(data, offset, 8, 'f64'); return { value: data.readDoubleLE(offset), bytesRead: 8 };
      case 'bool': ensureBytes(data, offset, 1, 'bool'); return { value: data[offset] !== 0, bytesRead: 1 };
      case 'publicKey': ensureBytes(data, offset, 32, 'publicKey'); return { value: new PublicKey(data.subarray(offset, offset + 32)), bytesRead: 32 };
      case 'string': {
        ensureBytes(data, offset, 4, 'string length');
        const len = data.readUInt32LE(offset);
        if (len > MAX_VEC_LEN) throw new Error(`String too long: ${len}`);
        ensureBytes(data, offset + 4, len, 'string data');
        const str = data.subarray(offset + 4, offset + 4 + len).toString('utf8');
        return { value: str, bytesRead: 4 + len };
      }
      case 'bytes': {
        ensureBytes(data, offset, 4, 'bytes length');
        const len = data.readUInt32LE(offset);
        if (len > MAX_VEC_LEN) throw new Error(`Bytes too long: ${len}`);
        ensureBytes(data, offset + 4, len, 'bytes data');
        return { value: data.subarray(offset + 4, offset + 4 + len), bytesRead: 4 + len };
      }
      default: throw new Error(`Unknown primitive type: ${type}`);
    }
  }

  if ('array' in type) {
    const [itemType, size] = type.array;
    if (itemType === 'u8') {
      ensureBytes(data, offset, size, `[u8; ${size}]`);
      return { value: data.subarray(offset, offset + size), bytesRead: size };
    }
    const arr = [];
    let total = 0;
    for (let i = 0; i < size; i++) {
      const { value, bytesRead } = deserializeType(itemType, data, offset + total, registry);
      arr.push(value);
      total += bytesRead;
    }
    return { value: arr, bytesRead: total };
  }

  if ('vec' in type) {
    ensureBytes(data, offset, 4, 'vec length');
    const len = data.readUInt32LE(offset);
    if (len > MAX_VEC_LEN) throw new Error(`Vec too long: ${len} (max ${MAX_VEC_LEN})`);
    const arr = [];
    let total = 4;
    for (let i = 0; i < len; i++) {
      const { value, bytesRead } = deserializeType(type.vec, data, offset + total, registry);
      arr.push(value);
      total += bytesRead;
    }
    return { value: arr, bytesRead: total };
  }

  if ('option' in type) {
    ensureBytes(data, offset, 1, 'option tag');
    const tag = data[offset];
    if (tag === 0) return { value: null, bytesRead: 1 };
    const { value, bytesRead } = deserializeType(type.option, data, offset + 1, registry);
    return { value, bytesRead: 1 + bytesRead };
  }

  // Defined type
  if ('defined' in type) {
    if (!registry) throw new Error(`No type registry for defined type: ${type.defined}`);
    const typeDef = registry.get(type.defined);
    if (!typeDef) throw new Error(`Unknown defined type: ${type.defined}`);

    if (typeDef.type.kind === 'struct' && typeDef.type.fields) {
      const obj: Record<string, any> = {};
      let total = 0;
      for (const field of typeDef.type.fields) {
        const { value, bytesRead } = deserializeType(field.type, data, offset + total, registry);
        obj[field.name] = value;
        total += bytesRead;
      }
      return { value: obj, bytesRead: total };
    }

    if (typeDef.type.kind === 'enum' && typeDef.type.variants) {
      ensureBytes(data, offset, 1, 'enum variant');
      const idx = data[offset];
      const variant = typeDef.type.variants[idx];
      if (!variant) throw new Error(`Unknown variant index ${idx} for enum ${type.defined}`);
      return { value: variant.name, bytesRead: 1 };
    }

    throw new Error(`Unsupported defined type kind: ${typeDef.type.kind}`);
  }

  throw new Error(`Cannot deserialize type: ${JSON.stringify(type)}`);
}
