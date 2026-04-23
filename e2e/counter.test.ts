import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import { execSync, spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

// Paths
const COUNTER_DIR = resolve(__dirname, '../examples/counter');
const COUNTER_SO = resolve(COUNTER_DIR, 'target/deploy/counter.so');
const COUNTER_KEYPAIR = resolve(COUNTER_DIR, 'target/deploy/counter-keypair.json');

// Compute Anchor-compatible discriminator
function discriminator(prefix: string, name: string): Buffer {
  return createHash('sha256').update(`${prefix}:${name}`).digest().subarray(0, 8);
}

let validator: ChildProcess;
let connection: Connection;
let payer: Keypair;
let programId: PublicKey;

describe('E2E: Counter program', () => {
  beforeAll(async () => {
    // 1. Build the counter program
    console.log('Building counter...');
    execSync('cargo build-sbf', { cwd: COUNTER_DIR, stdio: 'pipe' });
    expect(existsSync(COUNTER_SO)).toBe(true);

    // 2. Start local validator
    console.log('Starting test validator...');
    validator = spawn('solana-test-validator', ['--reset', '--quiet'], {
      stdio: 'pipe',
      detached: false,
    });

    // Wait for validator to be ready
    connection = new Connection('http://localhost:8899', 'confirmed');
    let retries = 30;
    while (retries > 0) {
      try {
        await connection.getSlot();
        break;
      } catch {
        await new Promise(r => setTimeout(r, 500));
        retries--;
      }
    }
    if (retries === 0) throw new Error('Validator failed to start');
    console.log('Validator ready');

    // 3. Create and fund payer
    payer = Keypair.generate();
    const sig = await connection.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);

    // 4. Deploy program with fresh keypair for localnet
    console.log('Deploying counter...');
    const programKeypair = Keypair.generate();
    programId = programKeypair.publicKey;

    const payerKeyFile = resolve(tmpdir(), `arlex-e2e-payer-${Date.now()}.json`);
    const programKeyFile = resolve(tmpdir(), `arlex-e2e-program-${Date.now()}.json`);
    writeFileSync(payerKeyFile, JSON.stringify(Array.from(payer.secretKey)));
    writeFileSync(programKeyFile, JSON.stringify(Array.from(programKeypair.secretKey)));

    try {
      // Wait a bit for airdrop to finalize
      await new Promise(r => setTimeout(r, 2000));

      const deployOutput = execSync(
        `solana program deploy ${COUNTER_SO} --program-id ${programKeyFile} --url localhost --keypair ${payerKeyFile}`,
        { cwd: COUNTER_DIR, encoding: 'utf8' }
      );
      console.log('Deploy output:', deployOutput.trim());

      // Wait for program to be available
      await new Promise(r => setTimeout(r, 2000));

      // Verify program is deployed
      const programInfo = await connection.getAccountInfo(programId);
      console.log('Program account exists:', !!programInfo);
      if (programInfo) {
        console.log('Program executable:', programInfo.executable);
        console.log('Program owner:', programInfo.owner.toBase58());
      }
    } finally {
      try { unlinkSync(payerKeyFile); } catch {}
      try { unlinkSync(programKeyFile); } catch {}
    }
    console.log(`Program deployed: ${programId.toBase58()}`);
  }, 60_000);

  afterAll(() => {
    if (validator) {
      validator.kill('SIGTERM');
    }
  });

  it('should initialize counter', async () => {
    // Create counter account
    const counterKeypair = Keypair.generate();
    const space = 8 + 32 + 8; // discriminator + authority + count
    const lamports = await connection.getMinimumBalanceForRentExemption(space);

    const createIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: counterKeypair.publicKey,
      lamports,
      space,
      programId,
    });

    // Build initialize instruction
    const disc = discriminator('global', 'initialize');
    const initIx = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: counterKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: disc,
    });

    const tx = new Transaction().add(createIx, initIx);
    await sendAndConfirmTransaction(connection, tx, [payer, counterKeypair]);

    // Verify account data
    const info = await connection.getAccountInfo(counterKeypair.publicKey);
    expect(info).not.toBeNull();
    expect(info!.data.length).toBe(space);

    // Check discriminator
    const expectedDisc = discriminator('account', 'Counter');
    expect(Buffer.from(info!.data.subarray(0, 8))).toEqual(expectedDisc);

    // Check authority = payer
    expect(Buffer.from(info!.data.subarray(8, 40))).toEqual(payer.publicKey.toBuffer());

    // Check count = 0
    const count = info!.data.readBigUInt64LE(40);
    expect(count).toBe(BigInt(0));

    // Store for next test
    (globalThis as any).__counterKey = counterKeypair.publicKey;
  }, 30_000);

  it('should increment counter', async () => {
    const counterKey: PublicKey = (globalThis as any).__counterKey;

    const disc = discriminator('global', 'increment');
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: counterKey, isSigner: false, isWritable: true },
      ],
      programId,
      data: disc,
    });

    await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);

    // Verify count = 1
    const info = await connection.getAccountInfo(counterKey);
    const count = info!.data.readBigUInt64LE(40);
    expect(count).toBe(BigInt(1));
  }, 30_000);

  it('should increment again to 2', async () => {
    const counterKey: PublicKey = (globalThis as any).__counterKey;

    const disc = discriminator('global', 'increment');
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: counterKey, isSigner: false, isWritable: true },
      ],
      programId,
      data: disc,
    });

    await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);

    const info = await connection.getAccountInfo(counterKey);
    const count = info!.data.readBigUInt64LE(40);
    expect(count).toBe(BigInt(2));
  }, 30_000);

  it('should reject wrong discriminator', async () => {
    const counterKey: PublicKey = (globalThis as any).__counterKey;

    // Send garbage discriminator
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: counterKey, isSigner: false, isWritable: true },
      ],
      programId,
      data: Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
    });

    await expect(
      sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer])
    ).rejects.toThrow();
  }, 30_000);

  it('should reject short instruction data', async () => {
    const counterKey: PublicKey = (globalThis as any).__counterKey;

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: counterKey, isSigner: false, isWritable: true },
      ],
      programId,
      data: Buffer.from([0x01, 0x02, 0x03]), // only 3 bytes, need 8
    });

    await expect(
      sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer])
    ).rejects.toThrow();
  }, 30_000);
});
