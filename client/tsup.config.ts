/**
 * tsup configuration for @arlex/client.
 *
 * Two entries:
 *   - src/index.ts          → dist/index.{js,mjs} + dist/index.d.{ts,mts}  (library)
 *   - src/codegen-runtime.ts → dist/codegen-runtime.{js,mjs} + d.ts        (codegen runtime split)
 *   - src/cli.ts             → dist/cli.js + dist/cli.mjs                  (CLI binary)
 *
 * The CLI entry is a separate config so we can scope `banner` (shebang) to it
 * without leaking into the library bundle. dist/index.js MUST NOT have a shebang.
 */
import { defineConfig } from 'tsup';

export default defineConfig([
  // Library + codegen-runtime entries (no shebang)
  {
    entry: {
      index: 'src/index.ts',
      'codegen-runtime': 'src/codegen-runtime.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: false,
    splitting: false,
  },
  // CLI entry — shebang lives in src/cli.ts and esbuild preserves it.
  // We do NOT use `banner: { js: '#!/usr/bin/env node' }` because that
  // would emit two shebangs (one from source, one from banner).
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: false,
    splitting: false,
  },
]);
