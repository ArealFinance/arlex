/**
 * arlex-cli binary E2E test (Phase 2 NOTE-2).
 *
 * Spawns the published CLI entry-point (`dist/cli.js`) as a real subprocess
 * via `child_process.spawnSync`. Catches the class of regressions the
 * in-process API tests cannot:
 *   - Missing or malformed shebang on line 1 (`#!/usr/bin/env node`).
 *   - Missing executable bit on `dist/cli.js`.
 *   - argv parsing breakage (e.g. commander version flag, required-arg gating).
 *   - Subcommand wiring (`generate-types` → 3 file outputs).
 *
 * Pre-requisite: `npm run build` must have been run so `dist/cli.js` exists.
 * Vitest runs from the package root (`framework/client`), so we resolve
 * `dist/cli.js` and the IDL fixture via __dirname.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cliPath = resolve(__dirname, '../../../dist/cli.js');
const fixtureIdl = resolve(__dirname, 'fixtures/minimal.idl.json');

describe('arlex-cli E2E', () => {
  beforeAll(() => {
    if (!existsSync(cliPath)) {
      throw new Error(
        `Build dist/ first: ${cliPath} missing. ` +
        `Run \`npm run build\` from framework/client before running this suite.`,
      );
    }
    if (!existsSync(fixtureIdl)) {
      throw new Error(`Fixture missing: ${fixtureIdl}`);
    }
  });

  it('shebang on line 1', () => {
    const content = readFileSync(cliPath, 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('executable bit set (owner)', () => {
    const mode = statSync(cliPath).mode;
    // 0o100 = owner execute. Build script runs `chmod +x dist/cli.js`.
    expect(mode & 0o100).toBeTruthy();
  });

  it('--version exits 0 and prints a semver-shaped string', () => {
    const res = spawnSync('node', [cliPath, '--version'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('--help exits 0 and lists generate-types subcommand', () => {
    const res = spawnSync('node', [cliPath, '--help'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('generate-types');
  });

  it('generate-types <idl> --out <dir> writes 3 files', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'arlex-cli-e2e-'));
    // tmpdir() is outside the package cwd, so we need --allow-out-outside-cwd
    // (WARN-1 guard in cli.ts). The fixture path is also outside cwd when
    // vitest is invoked from a sibling, but here vitest cwd = framework/client
    // and the fixture is under it, so only --out needs the opt-out.
    const res = spawnSync(
      'node',
      [
        cliPath,
        'generate-types',
        fixtureIdl,
        '--out',
        outDir,
        '--allow-out-outside-cwd',
      ],
      { encoding: 'utf8' },
    );
    expect(res.status).toBe(0);
    expect(existsSync(join(outDir, 'accounts.generated.ts'))).toBe(true);
    expect(existsSync(join(outDir, 'instructions.generated.ts'))).toBe(true);
    expect(existsSync(join(outDir, 'errors.generated.ts'))).toBe(true);
  });

  it('generated accounts.generated.ts contains explicit Buffer import (G3 follow-up)', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'arlex-cli-e2e-'));
    const res = spawnSync(
      'node',
      [
        cliPath,
        'generate-types',
        fixtureIdl,
        '--out',
        outDir,
        '--allow-out-outside-cwd',
      ],
      { encoding: 'utf8' },
    );
    expect(res.status).toBe(0);
    const accounts = readFileSync(join(outDir, 'accounts.generated.ts'), 'utf8');
    const instructions = readFileSync(join(outDir, 'instructions.generated.ts'), 'utf8');
    expect(accounts).toContain("import { Buffer } from 'buffer';");
    expect(instructions).toContain("import { Buffer } from 'buffer';");
  });

  it('generate-types missing required <idl> exits non-zero with stderr message', () => {
    const res = spawnSync('node', [cliPath, 'generate-types'], { encoding: 'utf8' });
    expect(res.status).not.toBe(0);
    expect(res.stderr.length).toBeGreaterThan(0);
  });
});
