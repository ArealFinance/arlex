# @arlex/client changelog

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
