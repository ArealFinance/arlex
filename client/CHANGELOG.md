# @arlex/client changelog

## 0.3.1 — 2026-05-07

- **fix(codegen)**: runtime parsers now honor pubkey overrides at decode
  time. Previously, generated `.d.ts` types declared `PublicKey` for
  pubkey-overridden `[u8; 32]` fields, but the runtime Borsh decoder
  returned raw `Uint8Array` (`number[]` shape on the wire) — forcing
  consumers to write a `toPublicKey(...)` adapter to bridge the gap.

  Codegen now emits a `PUBKEY_<NAME>_FIELDS` const for each account /
  defined struct listing the TS field names classified as `publicKey`
  (heuristic + sidecar overrides). Generated `parse*` parsers thread that
  list into `remapWireToTs` via the new `pubkeyFields` option, and
  matching values are wrapped in `new PublicKey(...)` directly. Nested
  defined structs use the structured `NestedRemapTarget` form so the
  wrapping recurses through `vec<defined>` / `[defined; N]` field shapes.

  No public API changes to `ArlexClient` or `codegen-runtime` (additive
  only — the new `pubkeyFields` option is optional, and the existing
  flat `WireFieldMap` shape for `nestedMaps`/`arrayMaps` still works).
  Encode side: `serializeArgs` now also accepts a `PublicKey` value for
  `[u8; 32]` fields (it already accepted Buffer / Uint8Array / number[]).
- **chore(cli)**: bump hardcoded CLI `--version` string to `0.3.1`.

## 0.3.0 — 2026-05-07

- **BREAKING (codegen output)**: per-program `defined-types.generated.ts`
  file added. Generated programs now have 4 files instead of 3:
  - `accounts.generated.ts`
  - `instructions.generated.ts`
  - `errors.generated.ts`
  - `defined-types.generated.ts` (NEW)

  Defined struct/enum interfaces, `WIRE_*_FIELDS` maps, `IDL_*_FIELDS`
  constants, and `TYPE_REGISTRY` are now emitted ONCE per program in
  `defined-types.generated.ts` instead of duplicated across
  `accounts.generated.ts` and `instructions.generated.ts`.

  Consumers of generated code must add
  `export * from './defined-types.generated.js';` to their program index
  re-exporters. No runtime API changes to `ArlexClient` or
  `codegen-runtime`. Phase 3.5 C.2.
- **chore(cli)**: bump hardcoded CLI `--version` string to `0.3.0`.

## 0.2.2 — 2026-05-06

- **fix(codegen)**: codegen template now emits explicit `import { Buffer } from 'buffer'`
  in `accounts.generated.ts` / `instructions.generated.ts`. Prevents regression
  after the next codegen run (was a 0.2.1 manual fix in 21 src files; 10 of
  those were codegen-emitted and would have been overwritten on the next
  `arlex-cli generate-types` invocation). G3 follow-up.
- **test(cli)**: add CLI binary E2E test (`child_process.spawn`-based) covering
  shebang, executable bit, `--version`, `--help`, `generate-types` happy path
  + missing-arg error. Catches regressions the in-process API tests cannot.
  Phase 2 NOTE-2.
- **test(packaging)**: add browser-bundle hygiene smoke test — static
  analysis asserting `dist/index.mjs` has no `node:*` / `fs` / `path`
  imports and no `vite-plugin-node-polyfills` shim references. Same
  regression class as Phase 3 Step L (`export * from './codegen'` leak)
  but caught at unit-test speed (<100ms vs ~10s for a real Vite bundle).
- **chore(cli)**: bump hardcoded CLI `--version` string from `0.2.0` to
  `0.2.2` (was lagging behind package version).

## 0.2.1 — 2026-05-06

- fix: remove codegen re-export from main entry (browser bundle leak —
  `./codegen/writer.ts` imports Node-only `fs`/`path`, which leaked into
  consumers' browser bundles via `export * from './codegen'` in
  `src/index.ts`. Vite/Rollup correctly refused to resolve
  `__vite-browser-external` for the `promises` named import, breaking
  the dashboard build at Phase 3 vendor refresh).
- Codegen API remains accessible via `@arlex/client/codegen-runtime`
  (browser-safe runtime helpers) and the `arlex-cli` binary (Node-only
  build-time tool). No public API surface change for codegen consumers
  who already use those entrypoints.
- chore: correct test count in 0.2.0 entry (332, not 305 — closes
  Phase 2 NOTE-3 cosmetic).

## 0.2.0 — 2026-05-06

Added codegen subcommand `arlex-cli generate-types`.

- New `src/codegen/` module — pure functions that turn an IDL JSON into
  three TypeScript source strings (accounts / instructions / errors).
- New `src/codegen-runtime.ts` module (separate package export
  `@arlex/client/codegen-runtime`) — the small runtime surface that
  generated files import from.
- New `arlex-cli` binary with a single `generate-types` subcommand
  supporting `--out`, `--pubkey-overrides`, `--program-name`, and
  `--check` (CI drift mode).
- HYBRID `[u8; 32]` classification: heuristic suffix matching with a
  negative-token block-list, plus optional sidecar overrides that always
  win.
- Deterministic output (no timestamps in the banner) so `git diff` is
  empty when re-running against an unchanged IDL.
- Two-entry `tsup` build — shebang scoped to the CLI bundle only.
- 332 unit + smoke tests covering naming, pubkey detection, type
  mapping, all three emitters, security/IDL hardening, idempotence,
  and end-to-end roundtrip through the existing serialization layer.

**No breaking changes to the runtime API.** `ArlexClient` and friends
keep their 0.1.x signatures.

### Out of scope (deferred to Phase 3)

- Event decoders.
- Instruction-bytes → named-instruction parsers.
- Enum-with-data (variants carrying struct fields).

## 0.1.0

Initial release — `ArlexClient`, runtime serialization, discriminator
helpers, IDL types.
