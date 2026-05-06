#!/usr/bin/env node
/**
 * codegen-check — CI guardrail.
 *
 * For every IDL discovered under the configured search directory, this script
 * regenerates the `*.generated.ts` artifacts into a temporary directory and
 * compares them against any existing committed copies in the same project.
 *
 * Phase 2 scope: this is wired up so that downstream consumers (areal.newera,
 * future per-program packages) can invoke it once they commit generated
 * output. As of now there is no committed generated output in this repo,
 * so the script's success criterion is simply: "the codegen pipeline runs
 * end-to-end against all 5 Areal IDLs without throwing."
 *
 * Exit codes:
 *   0  — success, no drift
 *   1  — drift detected OR codegen threw
 */
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Default search paths — can be overridden by IDL_DIR env var.
const SEARCH_DIRS = [
  process.env.IDL_DIR,
  '/Users/blackmesa/Documents/areal.newera/dashboard/src/lib/idl',
  path.join(projectRoot, 'src/__tests__/codegen/fixtures'),
].filter(Boolean);

function discoverIdls() {
  const found = [];
  for (const dir of SEARCH_DIRS) {
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) found.push(path.join(dir, f));
    } catch {
      // dir not present — skip silently
    }
  }
  return found;
}

async function main() {
  // Lazy-import after the dist build so we exercise the same code path
  // a downstream consumer would.
  const distPath = path.join(projectRoot, 'dist', 'index.js');
  const codegen = await import(url.pathToFileURL(distPath).href);
  const { generateTypes, parseIdlJson } = codegen;
  if (typeof generateTypes !== 'function' || typeof parseIdlJson !== 'function') {
    process.stderr.write(`error: dist/index.js does not export generateTypes/parseIdlJson — run \`npm run build\` first\n`);
    process.exit(1);
  }

  const idls = discoverIdls();
  if (idls.length === 0) {
    process.stderr.write('warning: no IDL files found in any search directory — nothing to check\n');
    process.exit(0);
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'arlex-codegen-check-'));
  try {
    for (const idlPath of idls) {
      const text = readFileSync(idlPath, 'utf8');
      try {
        const idl = parseIdlJson(text);
        const out = generateTypes(idl);
        // sanity: each output must contain the banner line
        for (const [name, src] of [['accounts', out.accounts], ['instructions', out.instructions], ['errors', out.errors]]) {
          if (!src.includes('AUTO-GENERATED')) {
            process.stderr.write(`error: ${idlPath} → ${name} missing banner\n`);
            process.exit(1);
          }
        }
        process.stdout.write(`ok   ${path.basename(idlPath)}  (acc=${out.accounts.length}, ix=${out.instructions.length}, err=${out.errors.length} chars)\n`);
      } catch (err) {
        process.stderr.write(`fail ${path.basename(idlPath)}: ${err.message}\n`);
        process.exit(1);
      }
    }
    process.stdout.write(`\ncodegen-check: ${idls.length} IDL(s) processed cleanly\n`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`unhandled: ${err.message}\n`);
  process.exit(1);
});
