# Arlex

A Solana framework built on [Pinocchio](https://github.com/anza-xyz/pinocchio), offering Anchor-style ergonomics (derive macros, account validation, typed IDL) with a small runtime and dramatically cheaper deploys.

> Solana programs written with Arlex deploy for roughly **14× less rent** than equivalent Anchor programs, and benchmarks show comparable or better CU consumption.

---

## Components

| Crate / package | Language | Purpose |
|---|---|---|
| [`arlex-lang`](./arlex-lang) | Rust | Runtime: account validation, context, CPI helpers, error types |
| [`arlex-derive`](./arlex-derive) | Rust | Proc macros: `#[program]`, `#[derive(Accounts)]`, instruction dispatch |
| [`arlex-cli`](./arlex-cli) | Rust | `arlex` CLI: init, build, IDL generation, upgrade |
| [`client`](./client) | TypeScript | `@arlex/client`: IDL-typed client, tx builders, account decoders |
| [`examples`](./examples) | Rust | `counter` (minimal) and `token-vault` (full example) |
| [`e2e`](./e2e) | TypeScript + Node | End-to-end tests against a local validator |

---

## Quick start

### Install the CLI

```bash
cargo install --path arlex-cli
```

### Create a new program

```bash
arlex init my-program
cd my-program
arlex build
```

See [`examples/counter`](./examples/counter) for the minimal project layout.

### Use in a Cargo workspace

```toml
[dependencies]
arlex-lang = { git = "https://github.com/ArealFinance/arlex" }
```

### Client (TypeScript)

```bash
npm install @arlex/client  # once published
# or as a git dependency:
# npm install github:ArealFinance/arlex#main:framework/client
```

---

## Design goals

- **Small runtime.** Pinocchio-based, no hidden allocations, no framework bloat.
- **Familiar DX.** `#[program]` + `#[derive(Accounts)]` feel like Anchor.
- **Cheap deploys.** Smaller `.so` files, fewer bytes of rent.
- **Typed client.** Auto-generated IDL drives a TypeScript client with full types.

---

## Production use

Arlex powers the [Areal Finance](https://areal.finance) protocol — five interoperating Solana programs (Ownership Token, Futarchy, RWT Engine, Native DEX, Yield Distribution). See [github.com/ArealFinance/areal](https://github.com/ArealFinance/areal).

---

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
