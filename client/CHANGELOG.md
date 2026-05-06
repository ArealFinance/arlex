# @arlex/client changelog

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
