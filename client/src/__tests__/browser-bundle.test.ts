/**
 * Browser-bundle hygiene smoke test (Phase 3 Step L retro).
 *
 * Static analysis of `dist/index.mjs` to catch the class of regression that
 * Phase 3 Step L exposed: `export * from './codegen'` in `src/index.ts` was
 * pulling Node-only modules (`fs`, `path` via `codegen/writer.ts`) into
 * consumer browser bundles. Vite/Rollup correctly refused to externalize
 * `__vite-browser-external` for the `promises` named import, breaking the
 * dashboard build.
 *
 * Why static analysis instead of a live Vite bundle:
 *   - Same regression class detected (Node-only references in browser entry).
 *   - <100ms vs ~10s for a real bundle — keeps CI fast.
 *   - No additional toolchain dependencies (vite/rollup) in the test surface.
 *
 * Pre-requisite: `npm run build` must have been run.
 *
 * SCOPE: this checks the BROWSER ENTRY (`dist/index.mjs`). The CLI bundle
 * (`dist/cli.js`) is intentionally Node-only and is exempt — see the
 * "CLI is allowed Node modules" sanity assertion below.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const distMjs = resolve(__dirname, '../../dist/index.mjs');
const cliJs = resolve(__dirname, '../../dist/cli.js');

describe('browser-bundle hygiene', () => {
  beforeAll(() => {
    if (!existsSync(distMjs)) {
      throw new Error(
        `Build dist/ first: ${distMjs} missing. ` +
        `Run \`npm run build\` from framework/client before running this suite.`,
      );
    }
    if (!existsSync(cliJs)) {
      throw new Error(`Build dist/ first: ${cliJs} missing.`);
    }
  });

  it('dist/index.mjs has no `node:*` imports', () => {
    const content = readFileSync(distMjs, 'utf8');
    expect(content).not.toMatch(/from\s+['"]node:/);
    expect(content).not.toMatch(/require\(['"]node:/);
  });

  it('dist/index.mjs has no `fs` imports', () => {
    const content = readFileSync(distMjs, 'utf8');
    expect(content).not.toMatch(/from\s+['"]fs['"]/);
    expect(content).not.toMatch(/require\(['"]fs['"]\)/);
  });

  it('dist/index.mjs has no `path` imports', () => {
    const content = readFileSync(distMjs, 'utf8');
    expect(content).not.toMatch(/from\s+['"]path['"]/);
    expect(content).not.toMatch(/require\(['"]path['"]\)/);
  });

  it('dist/index.mjs has no vite-plugin-node-polyfills shim references', () => {
    const content = readFileSync(distMjs, 'utf8');
    expect(content).not.toMatch(/vite-plugin-node-polyfills/);
    expect(content).not.toMatch(/shims\/buffer/);
  });

  it('dist/cli.js IS allowed to use Node modules (sanity — CLI is Node-only)', () => {
    // The CLI is a build-time tool, not consumer code, and legitimately
    // depends on `fs` / `path`. This assertion guards against accidentally
    // moving the test to the wrong file or generalizing the rule too far.
    const content = readFileSync(cliJs, 'utf8');
    const usesNodeApis =
      /node:/.test(content) ||
      /require\(['"]fs['"]\)/.test(content) ||
      /from\s+['"]fs['"]/.test(content);
    expect(usesNodeApis).toBe(true);
  });
});
