export { ArlexClient } from './client';
export type { ExecuteOptions, FetchOptions } from './client';
export type { Idl, IdlInstruction, IdlAccountItem, IdlField, IdlType, IdlAccountDef, IdlTypeDef, IdlEvent, IdlError } from './types';
export { instructionDiscriminator, accountDiscriminator, eventDiscriminator } from './discriminator';
export { serializeArgs, deserializeAccount, buildTypeRegistry } from './serialization';
export type { TypeRegistry } from './serialization';
export { ArlexProgramError, decodeError, extractErrorCode } from './errors';

// NOTE: Codegen module is intentionally NOT re-exported here.
// `./codegen/writer.ts` imports Node-only `fs`/`path`, and re-exporting it
// from the browser-facing main entry leaks those imports into consumer
// bundles (Vite/Rollup correctly fail to resolve `__vite-browser-external`).
//
// Codegen is exposed via two dedicated entrypoints:
//   - `@arlex/client/codegen-runtime` — browser-safe runtime helpers used
//     by code emitted by the generator.
//   - `arlex-cli` binary (dist/cli.js) — Node-only build-time tool that
//     wraps `generateTypes` for shell/CI use.
