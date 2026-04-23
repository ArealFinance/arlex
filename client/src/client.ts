import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import bs58 from 'bs58';
import type { Idl, IdlInstruction, IdlAccountDef, IdlAccountItem } from './types';
import { instructionDiscriminator, accountDiscriminator } from './discriminator';
import { serializeArgs, deserializeAccount, buildTypeRegistry, TypeRegistry } from './serialization';
import { decodeError, extractErrorCode, ArlexProgramError } from './errors';

export interface ExecuteOptions {
  accounts: Record<string, PublicKey>;
  args?: Record<string, any>;
  signers?: Keypair[];
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  computeUnits?: number;
  priorityFee?: number;
}

export interface FetchOptions {
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

export class ArlexClient {
  private instructionMap: Map<string, IdlInstruction>;
  private accountMap: Map<string, IdlAccountDef>;
  private typeRegistry: TypeRegistry;

  constructor(
    public readonly idl: Idl,
    public readonly programId: PublicKey,
    public readonly connection: Connection,
  ) {
    // Null-safe: default to empty arrays if IDL fields missing
    this.instructionMap = new Map((idl.instructions ?? []).map(ix => [ix.name, ix]));
    this.accountMap = new Map((idl.accounts ?? []).map(acc => [acc.name, acc]));
    this.typeRegistry = buildTypeRegistry(idl.types ?? [], idl.accounts ?? []);
  }

  /**
   * Build a Transaction without sending — for wallet adapter integration.
   * Returns the transaction for external signing (Phantom, Solflare, etc.)
   */
  buildTransaction(
    instructionName: string,
    options: ExecuteOptions,
  ): Transaction {
    const ix = this.buildInstruction(instructionName, options);
    const tx = new Transaction();

    if (options.computeUnits) {
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: options.computeUnits }));
    }
    if (options.priorityFee) {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: options.priorityFee }));
    }

    tx.add(ix);
    return tx;
  }

  /**
   * Build a single TransactionInstruction
   */
  buildInstruction(
    instructionName: string,
    options: ExecuteOptions,
  ): TransactionInstruction {
    const ixDef = this.instructionMap.get(instructionName);
    if (!ixDef) throw new Error(`Unknown instruction: ${instructionName}. Available: ${[...this.instructionMap.keys()].join(', ')}`);

    const disc = instructionDiscriminator(instructionName);
    const argsData = ixDef.args.length > 0 && options.args
      ? serializeArgs(ixDef.args, options.args, this.typeRegistry)
      : Buffer.alloc(0);
    const data = Buffer.concat([disc, argsData]);

    const keys = ixDef.accounts.map((accDef: IdlAccountItem) => {
      const pubkey = options.accounts[accDef.name];
      if (!pubkey) throw new Error(`Missing account '${accDef.name}' for instruction '${instructionName}'`);
      return { pubkey, isSigner: accDef.isSigner, isWritable: accDef.isMut };
    });

    if (options.remainingAccounts) {
      keys.push(...options.remainingAccounts);
    }

    return new TransactionInstruction({ keys, programId: this.programId, data });
  }

  /**
   * Execute an instruction with Keypair signing (for scripts/CLI)
   */
  async execute(
    instructionName: string,
    options: ExecuteOptions,
    payer: Keypair,
  ): Promise<string> {
    const tx = this.buildTransaction(instructionName, options);
    tx.feePayer = payer.publicKey;

    const signers = [payer, ...(options.signers || [])];

    try {
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;

      const sig = await this.connection.sendTransaction(tx, signers, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      // Poll for confirmation (works without WebSocket)
      await this.pollConfirmation(sig, lastValidBlockHeight);
      return sig;
    } catch (err: any) {
      const code = extractErrorCode(err);
      if (code !== null && this.idl.errors) {
        throw decodeError(code, this.idl.errors);
      }
      throw err;
    }
  }

  /**
   * Poll getSignatureStatuses until confirmed or expired.
   * Works without WebSocket — pure HTTP polling.
   */
  private async pollConfirmation(
    signature: string,
    lastValidBlockHeight: number,
    intervalMs = 1000,
    timeoutMs = 60000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const status = value?.[0];
      if (status) {
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          return;
        }
      }
      const blockHeight = await this.connection.getBlockHeight('confirmed');
      if (blockHeight > lastValidBlockHeight) {
        throw new Error('Transaction expired: block height exceeded');
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
  }

  /**
   * Fetch and deserialize an account
   */
  async fetch(
    accountType: string,
    address: PublicKey,
    options?: FetchOptions,
  ): Promise<Record<string, any>> {
    const accDef = this.accountMap.get(accountType);
    if (!accDef) throw new Error(`Unknown account type: ${accountType}. Available: ${[...this.accountMap.keys()].join(', ')}`);

    const info = await this.connection.getAccountInfo(address, options?.commitment || 'confirmed');
    if (!info) throw new Error(`Account not found: ${address.toBase58()}`);
    if (!info.owner.equals(this.programId)) {
      throw new Error(`Account ${address.toBase58()} owned by ${info.owner.toBase58()}, expected ${this.programId.toBase58()}`);
    }

    const expectedDisc = accountDiscriminator(accountType);
    const actualDisc = info.data.subarray(0, 8);
    if (!expectedDisc.equals(actualDisc)) {
      throw new Error(`Discriminator mismatch for ${accountType}: expected ${expectedDisc.toString('hex')}, got ${actualDisc.toString('hex')}`);
    }

    return deserializeAccount(accDef.type.fields, info.data, this.typeRegistry);
  }

  /**
   * Fetch all accounts of a given type (via getProgramAccounts + discriminator filter)
   */
  async fetchAll(
    accountType: string,
    options?: FetchOptions,
  ): Promise<{ address: PublicKey; data: Record<string, any> }[]> {
    const accDef = this.accountMap.get(accountType);
    if (!accDef) throw new Error(`Unknown account type: ${accountType}`);

    const disc = accountDiscriminator(accountType);

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      commitment: options?.commitment || 'confirmed',
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(disc) } },
      ],
    });

    return accounts.map(({ pubkey, account }) => ({
      address: pubkey,
      data: deserializeAccount(accDef.type.fields, account.data, this.typeRegistry),
    }));
  }

  /**
   * Simulate a transaction (dry run)
   */
  async simulate(
    instructionName: string,
    options: ExecuteOptions,
    feePayer: PublicKey,
  ): Promise<{ success: boolean; logs: string[]; unitsConsumed: number; error: ArlexProgramError | null }> {
    const tx = this.buildTransaction(instructionName, options);
    tx.feePayer = feePayer;

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    // sigVerify: false — allows simulation without signatures (wallet adapter flow)
    const sim = await this.connection.simulateTransaction(tx, undefined);

    let error: ArlexProgramError | null = null;
    if (sim.value.err) {
      const code = extractErrorCode(sim.value.err);
      if (code !== null && this.idl.errors) {
        error = decodeError(code, this.idl.errors);
      }
    }

    return {
      success: sim.value.err === null,
      logs: sim.value.logs || [],
      unitsConsumed: sim.value.unitsConsumed || 0,
      error,
    };
  }

  /**
   * Subscribe to account changes (WebSocket)
   */
  onAccountChange(
    accountType: string,
    address: PublicKey,
    callback: (data: Record<string, any>) => void,
    onError?: (err: Error) => void,
  ): number {
    const accDef = this.accountMap.get(accountType);
    if (!accDef) throw new Error(`Unknown account type: ${accountType}`);

    return this.connection.onAccountChange(address, (info) => {
      try {
        const data = deserializeAccount(accDef.type.fields, info.data, this.typeRegistry);
        callback(data);
      } catch (err: any) {
        if (onError) {
          onError(err);
        } else {
          console.warn(`[arlex] Failed to deserialize ${accountType} at ${address.toBase58()}:`, err.message);
        }
      }
    }, 'confirmed');
  }

  /**
   * Unsubscribe from account changes
   */
  async removeListener(subscriptionId: number): Promise<void> {
    await this.connection.removeAccountChangeListener(subscriptionId);
  }

  /**
   * Get instruction discriminator bytes
   */
  getDiscriminator(instructionName: string): Buffer {
    return instructionDiscriminator(instructionName);
  }

  /**
   * Get account discriminator bytes
   */
  getAccountDiscriminator(accountType: string): Buffer {
    return accountDiscriminator(accountType);
  }
}
