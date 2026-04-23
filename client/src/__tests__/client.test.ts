import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Connection, Keypair } from '@solana/web3.js';
import { ArlexClient } from '../client';
import { accountDiscriminator, instructionDiscriminator } from '../discriminator';
import type { Idl } from '../types';

// Minimal IDL for testing
const testIdl: Idl = {
  version: '0.1.0',
  name: 'test_program',
  metadata: { address: '11111111111111111111111111111112' },
  instructions: [
    {
      name: 'initialize',
      accounts: [
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'counter', isMut: true, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'increment',
      accounts: [
        { name: 'authority', isMut: false, isSigner: true },
        { name: 'counter', isMut: true, isSigner: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
  accounts: [
    {
      name: 'Counter',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: { array: ['u8', 32] } },
          { name: 'count', type: 'u64' },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: 'Unauthorized', msg: 'Not authorized' },
    { code: 6001, name: 'Overflow', msg: 'Arithmetic overflow' },
  ],
  events: [
    {
      name: 'Incremented',
      fields: [
        { name: 'count', type: 'u64' },
      ],
    },
  ],
};

const programId = new PublicKey('11111111111111111111111111111112');

// Mock connection
function mockConnection(overrides: Record<string, any> = {}): Connection {
  return {
    getAccountInfo: vi.fn(),
    getProgramAccounts: vi.fn(),
    sendTransaction: vi.fn(),
    confirmTransaction: vi.fn(),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: 'test', lastValidBlockHeight: 100 }),
    simulateTransaction: vi.fn(),
    onAccountChange: vi.fn().mockReturnValue(1),
    removeAccountChangeListener: vi.fn(),
    ...overrides,
  } as any;
}

describe('ArlexClient', () => {
  // ==================== Constructor ====================

  describe('constructor', () => {
    it('initializes with valid IDL', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      expect(client.idl.name).toBe('test_program');
      expect(client.programId.equals(programId)).toBe(true);
    });

    it('handles empty IDL without crashing', () => {
      const conn = mockConnection();
      const emptyIdl: Idl = {
        version: '0.1.0',
        name: 'empty',
        instructions: [],
        accounts: [],
      };
      const client = new ArlexClient(emptyIdl, programId, conn);
      expect(client.idl.name).toBe('empty');
    });

    it('handles partial IDL (missing types, events, errors)', () => {
      const conn = mockConnection();
      const partialIdl: any = {
        version: '0.1.0',
        name: 'partial',
        instructions: [{ name: 'init', accounts: [], args: [] }],
        accounts: [],
        // no types, events, errors
      };
      expect(() => new ArlexClient(partialIdl, programId, conn)).not.toThrow();
    });

    it('handles IDL with null fields', () => {
      const conn = mockConnection();
      const nullIdl: any = {
        version: '0.1.0',
        name: 'nulls',
        instructions: null,
        accounts: null,
        types: null,
      };
      expect(() => new ArlexClient(nullIdl, programId, conn)).not.toThrow();
    });
  });

  // ==================== buildInstruction ====================

  describe('buildInstruction', () => {
    it('builds instruction with correct discriminator', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const authority = Keypair.generate().publicKey;
      const counter = Keypair.generate().publicKey;

      const ix = client.buildInstruction('initialize', {
        accounts: { authority, counter },
      });

      // Check discriminator (first 8 bytes)
      const expectedDisc = instructionDiscriminator('initialize');
      expect(ix.data.subarray(0, 8)).toEqual(expectedDisc);
      expect(ix.data.length).toBe(8); // no args
    });

    it('builds instruction with serialized args', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const authority = Keypair.generate().publicKey;
      const counter = Keypair.generate().publicKey;

      const ix = client.buildInstruction('increment', {
        accounts: { authority, counter },
        args: { amount: BigInt(42) },
      });

      // 8 byte discriminator + 8 byte u64
      expect(ix.data.length).toBe(16);
      // Verify amount is correctly serialized after discriminator
      const amount = ix.data.readBigUInt64LE(8);
      expect(amount).toBe(BigInt(42));
    });

    it('sets correct account keys and flags', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const authority = Keypair.generate().publicKey;
      const counter = Keypair.generate().publicKey;

      const ix = client.buildInstruction('initialize', {
        accounts: { authority, counter },
      });

      expect(ix.keys.length).toBe(2);
      expect(ix.keys[0].pubkey.equals(authority)).toBe(true);
      expect(ix.keys[0].isSigner).toBe(true);
      expect(ix.keys[0].isWritable).toBe(true);
      expect(ix.keys[1].pubkey.equals(counter)).toBe(true);
      expect(ix.keys[1].isSigner).toBe(false);
      expect(ix.keys[1].isWritable).toBe(true);
    });

    it('appends remaining accounts', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const authority = Keypair.generate().publicKey;
      const counter = Keypair.generate().publicKey;
      const extra = Keypair.generate().publicKey;

      const ix = client.buildInstruction('initialize', {
        accounts: { authority, counter },
        remainingAccounts: [{ pubkey: extra, isSigner: false, isWritable: true }],
      });

      expect(ix.keys.length).toBe(3);
      expect(ix.keys[2].pubkey.equals(extra)).toBe(true);
    });

    it('throws on unknown instruction', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);

      expect(() => client.buildInstruction('nonexistent', {
        accounts: {},
      })).toThrow('Unknown instruction: nonexistent');
    });

    it('error message lists available instructions', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);

      expect(() => client.buildInstruction('bad', {
        accounts: {},
      })).toThrow('initialize, increment');
    });

    it('throws on missing account', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);

      expect(() => client.buildInstruction('initialize', {
        accounts: { authority: Keypair.generate().publicKey },
        // missing 'counter'
      })).toThrow("Missing account 'counter'");
    });
  });

  // ==================== buildTransaction ====================

  describe('buildTransaction', () => {
    it('adds compute budget instructions', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const authority = Keypair.generate().publicKey;
      const counter = Keypair.generate().publicKey;

      const tx = client.buildTransaction('initialize', {
        accounts: { authority, counter },
        computeUnits: 300_000,
        priorityFee: 50_000,
      });

      // 2 compute budget + 1 program instruction
      expect(tx.instructions.length).toBe(3);
    });

    it('returns unsigned transaction (for wallet adapter)', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const authority = Keypair.generate().publicKey;
      const counter = Keypair.generate().publicKey;

      const tx = client.buildTransaction('initialize', {
        accounts: { authority, counter },
      });

      // Transaction should not have signatures
      expect(tx.signatures.length).toBe(0);
      // Should have 1 instruction
      expect(tx.instructions.length).toBe(1);
    });
  });

  // ==================== fetch ====================

  describe('fetch', () => {
    it('deserializes account data correctly', async () => {
      const authority = Keypair.generate().publicKey;
      const disc = accountDiscriminator('Counter');
      const data = Buffer.alloc(8 + 32 + 8);
      disc.copy(data, 0);
      authority.toBuffer().copy(data, 8);
      data.writeBigUInt64LE(BigInt(42), 40);

      const conn = mockConnection({
        getAccountInfo: vi.fn().mockResolvedValue({
          data,
          owner: programId,
          lamports: 1000000,
          executable: false,
        }),
      });

      const client = new ArlexClient(testIdl, programId, conn);
      const result = await client.fetch('Counter', Keypair.generate().publicKey);

      expect(Buffer.from(result.authority)).toEqual(authority.toBuffer());
      expect(result.count).toBe(BigInt(42));
    });

    it('throws if account not found', async () => {
      const conn = mockConnection({
        getAccountInfo: vi.fn().mockResolvedValue(null),
      });

      const client = new ArlexClient(testIdl, programId, conn);
      await expect(client.fetch('Counter', Keypair.generate().publicKey))
        .rejects.toThrow('Account not found');
    });

    it('throws if wrong owner', async () => {
      const wrongOwner = Keypair.generate().publicKey;
      const conn = mockConnection({
        getAccountInfo: vi.fn().mockResolvedValue({
          data: Buffer.alloc(48),
          owner: wrongOwner,
          lamports: 1000000,
        }),
      });

      const client = new ArlexClient(testIdl, programId, conn);
      await expect(client.fetch('Counter', Keypair.generate().publicKey))
        .rejects.toThrow('owned by');
    });

    it('throws if discriminator mismatch', async () => {
      const conn = mockConnection({
        getAccountInfo: vi.fn().mockResolvedValue({
          data: Buffer.alloc(48), // all zeros — wrong discriminator
          owner: programId,
          lamports: 1000000,
        }),
      });

      const client = new ArlexClient(testIdl, programId, conn);
      await expect(client.fetch('Counter', Keypair.generate().publicKey))
        .rejects.toThrow('Discriminator mismatch');
    });

    it('throws on unknown account type', async () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);

      await expect(client.fetch('NonExistent', Keypair.generate().publicKey))
        .rejects.toThrow('Unknown account type: NonExistent');
    });
  });

  // ==================== getDiscriminator ====================

  describe('getDiscriminator', () => {
    it('returns correct instruction discriminator', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const disc = client.getDiscriminator('initialize');
      expect(disc).toEqual(instructionDiscriminator('initialize'));
    });

    it('returns correct account discriminator', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const disc = client.getAccountDiscriminator('Counter');
      expect(disc).toEqual(accountDiscriminator('Counter'));
    });
  });

  // ==================== onAccountChange ====================

  describe('onAccountChange', () => {
    it('returns subscription id', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      const id = client.onAccountChange('Counter', Keypair.generate().publicKey, () => {});
      expect(id).toBe(1);
    });

    it('throws on unknown account type', () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      expect(() => client.onAccountChange('Bad', Keypair.generate().publicKey, () => {}))
        .toThrow('Unknown account type');
    });
  });

  // ==================== removeListener ====================

  describe('removeListener', () => {
    it('calls connection.removeAccountChangeListener', async () => {
      const removeFn = vi.fn().mockResolvedValue(undefined);
      const conn = mockConnection({ removeAccountChangeListener: removeFn });
      const client = new ArlexClient(testIdl, programId, conn);
      await client.removeListener(42);
      expect(removeFn).toHaveBeenCalledWith(42);
    });
  });

  // ==================== execute ====================

  describe('execute', () => {
    it('sends transaction and returns signature', async () => {
      const sendFn = vi.fn().mockResolvedValue('fakeSig123');
      const confirmFn = vi.fn().mockResolvedValue({ value: {} });
      const conn = mockConnection({ sendTransaction: sendFn, confirmTransaction: confirmFn });
      const client = new ArlexClient(testIdl, programId, conn);

      const payer = Keypair.generate();
      const authority = payer.publicKey;
      const counter = Keypair.generate().publicKey;

      const sig = await client.execute('initialize', {
        accounts: { authority, counter },
      }, payer);

      expect(sig).toBe('fakeSig123');
      expect(sendFn).toHaveBeenCalledTimes(1);
      expect(confirmFn).toHaveBeenCalledWith('fakeSig123', 'confirmed');
    });

    it('passes payer + additional signers', async () => {
      const sendFn = vi.fn().mockResolvedValue('sig');
      const confirmFn = vi.fn().mockResolvedValue({ value: {} });
      const conn = mockConnection({ sendTransaction: sendFn, confirmTransaction: confirmFn });
      const client = new ArlexClient(testIdl, programId, conn);

      const payer = Keypair.generate();
      const extraSigner = Keypair.generate();

      await client.execute('initialize', {
        accounts: { authority: payer.publicKey, counter: Keypair.generate().publicKey },
        signers: [extraSigner],
      }, payer);

      // sendTransaction receives [payer, extraSigner] as signers
      const signers = sendFn.mock.calls[0][1];
      expect(signers.length).toBe(2);
      expect(signers[0].publicKey.equals(payer.publicKey)).toBe(true);
      expect(signers[1].publicKey.equals(extraSigner.publicKey)).toBe(true);
    });

    it('decodes custom program error', async () => {
      const sendFn = vi.fn().mockRejectedValue({
        InstructionError: [0, { Custom: 6000 }],
        message: 'Transaction simulation failed',
      });
      const conn = mockConnection({ sendTransaction: sendFn });
      const client = new ArlexClient(testIdl, programId, conn);
      const payer = Keypair.generate();

      await expect(client.execute('initialize', {
        accounts: { authority: payer.publicKey, counter: Keypair.generate().publicKey },
      }, payer)).rejects.toThrow('Unauthorized');
    });

    it('re-throws non-custom error', async () => {
      const sendFn = vi.fn().mockRejectedValue(new Error('Network timeout'));
      const conn = mockConnection({ sendTransaction: sendFn });
      const client = new ArlexClient(testIdl, programId, conn);
      const payer = Keypair.generate();

      await expect(client.execute('initialize', {
        accounts: { authority: payer.publicKey, counter: Keypair.generate().publicKey },
      }, payer)).rejects.toThrow('Network timeout');
    });
  });

  // ==================== simulate ====================

  describe('simulate', () => {
    it('returns success with logs and units', async () => {
      const simFn = vi.fn().mockResolvedValue({
        value: {
          err: null,
          logs: ['Program log: initialized'],
          unitsConsumed: 5000,
        },
      });
      const conn = mockConnection({ simulateTransaction: simFn });
      const client = new ArlexClient(testIdl, programId, conn);

      const result = await client.simulate('initialize', {
        accounts: {
          authority: Keypair.generate().publicKey,
          counter: Keypair.generate().publicKey,
        },
      }, Keypair.generate().publicKey);

      expect(result.success).toBe(true);
      expect(result.logs).toEqual(['Program log: initialized']);
      expect(result.unitsConsumed).toBe(5000);
      expect(result.error).toBeNull();
    });

    it('decodes error from simulation', async () => {
      const simFn = vi.fn().mockResolvedValue({
        value: {
          err: { InstructionError: [0, { Custom: 6001 }] },
          logs: ['Program log: error'],
          unitsConsumed: 3000,
        },
      });
      const conn = mockConnection({ simulateTransaction: simFn });
      const client = new ArlexClient(testIdl, programId, conn);

      const result = await client.simulate('increment', {
        accounts: {
          authority: Keypair.generate().publicKey,
          counter: Keypair.generate().publicKey,
        },
        args: { amount: BigInt(1) },
      }, Keypair.generate().publicKey);

      expect(result.success).toBe(false);
      expect(result.error).not.toBeNull();
      expect(result.error!.code).toBe(6001);
      expect(result.error!.errorName).toBe('Overflow');
    });
  });

  // ==================== fetchAll ====================

  describe('fetchAll', () => {
    it('returns deserialized accounts', async () => {
      const disc = accountDiscriminator('Counter');
      const pk1 = Keypair.generate().publicKey;
      const pk2 = Keypair.generate().publicKey;

      const makeData = (count: bigint) => {
        const buf = Buffer.alloc(48);
        disc.copy(buf, 0);
        // authority: 32 zero bytes
        buf.writeBigUInt64LE(count, 40);
        return buf;
      };

      const getProgramAccountsFn = vi.fn().mockResolvedValue([
        { pubkey: pk1, account: { data: makeData(BigInt(10)), owner: programId, lamports: 1000 } },
        { pubkey: pk2, account: { data: makeData(BigInt(20)), owner: programId, lamports: 1000 } },
      ]);
      const conn = mockConnection({ getProgramAccounts: getProgramAccountsFn });
      const client = new ArlexClient(testIdl, programId, conn);

      const results = await client.fetchAll('Counter');

      expect(results.length).toBe(2);
      expect(results[0].address.equals(pk1)).toBe(true);
      expect(results[0].data.count).toBe(BigInt(10));
      expect(results[1].data.count).toBe(BigInt(20));
    });

    it('returns empty array when no accounts', async () => {
      const conn = mockConnection({
        getProgramAccounts: vi.fn().mockResolvedValue([]),
      });
      const client = new ArlexClient(testIdl, programId, conn);
      const results = await client.fetchAll('Counter');
      expect(results).toEqual([]);
    });

    it('passes discriminator filter to RPC', async () => {
      const getProgramAccountsFn = vi.fn().mockResolvedValue([]);
      const conn = mockConnection({ getProgramAccounts: getProgramAccountsFn });
      const client = new ArlexClient(testIdl, programId, conn);

      await client.fetchAll('Counter');

      const callArgs = getProgramAccountsFn.mock.calls[0];
      expect(callArgs[0].equals(programId)).toBe(true);
      expect(callArgs[1].filters).toBeDefined();
      expect(callArgs[1].filters[0].memcmp.offset).toBe(0);
    });

    it('throws on unknown account type', async () => {
      const conn = mockConnection();
      const client = new ArlexClient(testIdl, programId, conn);
      await expect(client.fetchAll('Bad')).rejects.toThrow('Unknown account type');
    });
  });

  // ==================== onAccountChange callback ====================

  describe('onAccountChange callback', () => {
    it('calls callback with deserialized data on change', () => {
      const disc = accountDiscriminator('Counter');
      const data = Buffer.alloc(48);
      disc.copy(data, 0);
      data.writeBigUInt64LE(BigInt(99), 40);

      let capturedCallback: any;
      const conn = mockConnection({
        onAccountChange: vi.fn().mockImplementation((_addr: any, cb: any) => {
          capturedCallback = cb;
          return 1;
        }),
      });

      const client = new ArlexClient(testIdl, programId, conn);
      const results: any[] = [];
      client.onAccountChange('Counter', Keypair.generate().publicKey, (d) => results.push(d));

      // Simulate account change
      capturedCallback({ data, owner: programId, lamports: 1000 });

      expect(results.length).toBe(1);
      expect(results[0].count).toBe(BigInt(99));
    });

    it('calls onError on deserialization failure', () => {
      let capturedCallback: any;
      const conn = mockConnection({
        onAccountChange: vi.fn().mockImplementation((_addr: any, cb: any) => {
          capturedCallback = cb;
          return 1;
        }),
      });

      const client = new ArlexClient(testIdl, programId, conn);
      const errors: Error[] = [];
      client.onAccountChange(
        'Counter',
        Keypair.generate().publicKey,
        () => {},
        (err) => errors.push(err),
      );

      // Send bad data (too short)
      capturedCallback({ data: Buffer.alloc(4), owner: programId, lamports: 0 });

      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain('too short');
    });

    it('logs warning when no onError provided', () => {
      let capturedCallback: any;
      const conn = mockConnection({
        onAccountChange: vi.fn().mockImplementation((_addr: any, cb: any) => {
          capturedCallback = cb;
          return 1;
        }),
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = new ArlexClient(testIdl, programId, conn);
      client.onAccountChange('Counter', Keypair.generate().publicKey, () => {});

      capturedCallback({ data: Buffer.alloc(4), owner: programId, lamports: 0 });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });
});
