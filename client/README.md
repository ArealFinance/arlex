# @arlex/client

Lightweight TypeScript client for Arlex (Anchor-compatible) Solana programs.

Provides:

- **Runtime**: `ArlexClient` — IDL-driven instruction encoding, account fetching, error decoding.
- **Codegen** (since 0.2.0): generate fully-typed `*.generated.ts` modules from an IDL JSON.

---

## Codegen

`@arlex/client` ships an IDL-to-TypeScript generator that emits typed
account interfaces, instruction encoders, and error enums per program.

### Quickstart

```bash
npx arlex-cli generate-types ./idl/myprogram.json --out ./src/generated
```

This writes three files into `./src/generated/`:

- `accounts.generated.ts` — `interface MyAccount { ... }` + `parseMyAccount(data)` + discriminators.
- `instructions.generated.ts` — `interface MyIxArgs { ... }`, `interface MyIxAccounts { ... }`, `encodeMyIxArgs(args)`, discriminators.
- `errors.generated.ts` — `enum ProgramErrorCode { ... }` + `decodeProgramError(input)` wrapper.

Generated files import only from `@arlex/client/codegen-runtime`, which
re-exports the small set of helpers they need (`PublicKey`, `Bytes32`,
`serializeArgs`, `deserializeAccount`, etc.).

### Output example

Given an IDL field:

```json
{ "name": "wallet_address", "type": { "array": ["u8", 32] } }
```

the generator emits:

```ts
export interface MyAccount {
  walletAddress: PublicKey;
  // ...
}
```

with a `WIRE_MYACCOUNT_FIELDS` map preserving the snake_case wire keys
so that the runtime serializer can roundtrip through Borsh unchanged.

### Pubkey detection

A `[u8; 32]` field is surfaced as `PublicKey` (instead of `Bytes32`) iff:

1. The field name ends with one of the recognized suffixes:
   `_authority`, `_owner`, `_pubkey`, `_address`, `_payer`, `_recipient`,
   `_treasury`, `_mint`, `_token`, `_program`, `_signer`, `_creator`,
   `_admin`, `_destination`, `_dest`, `_source`, `_src`, `_oracle`,
   `_keeper`, `_proposer`, `_executor`, `_feed`.
2. **AND** the field name does NOT contain any of:
   `hash`, `root`, `seed`, `nonce`, `digest`, `commitment`, `bump_seed`.
3. **OR** an explicit override in a sidecar `pubkey-overrides.json` (overrides win).

For other `[u8; 32]` fields we emit `Bytes32` (an alias for `Uint8Array`).

#### Sidecar overrides

```json
{
  "Pool": {
    "vault_a": "publicKey",
    "vault_b": "publicKey",
    "internal_blob": "bytes32"
  }
}
```

```bash
npx arlex-cli generate-types ./idl/native-dex.json \
    --out ./src/generated \
    --pubkey-overrides ./codegen/pubkey-overrides.json
```

The override key is the IDL type name (account or defined struct); the
inner key is the field name (snake_case or camelCase — both work).

### `--check` mode (CI guardrail)

```bash
npx arlex-cli generate-types ./idl/myprogram.json --out ./src/generated --check
```

Exits 0 if generated output matches what's on disk, exits 1 with a list
of drifted files otherwise. Use this in CI to enforce that generated
files are kept in sync with their IDL source.

### Determinism

Generated output is byte-deterministic given the same IDL input. There
are no timestamps in the banner — only the IDL name, IDL version, and
generator version. Re-running the codegen against an unchanged IDL is a
no-op for downstream `git diff`.

### Limitations (Phase 2)

The following are intentionally **out of scope** and will be addressed in
Phase 3:

- **Event decoders** — `events[]` is parsed but no runtime helpers are emitted.
- **Instruction parsers** — only encoders. Decoding raw ix bytes back into
  named instructions is not supported.
- **Enum-with-data** — Anchor enums whose variants carry struct fields
  throw `UnsupportedTypeError` during codegen. Tag-only enums are supported.

If you hit one of these, file an issue or supply a hand-written wrapper.

---

## Runtime API

The runtime side of the package is unchanged from 0.1.x.

```ts
import { ArlexClient } from '@arlex/client';

const client = new ArlexClient(idl, programId, connection);

// Build + send
const sig = await client.execute('initialize', { accounts: { /* ... */ }, args: { amount: 100n } }, payer);

// Fetch + decode
const acc = await client.fetch('Pool', poolPubkey);
```

See `src/client.ts` for the full surface.
