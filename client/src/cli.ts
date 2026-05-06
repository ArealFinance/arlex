#!/usr/bin/env node
/**
 * arlex-cli — command-line interface for @arlex/client.
 *
 * Currently supports a single subcommand:
 *   generate-types <idl> --out <dir>
 *       [--pubkey-overrides <file>]
 *       [--program-name <name>]
 *       [--check]
 *       [--allow-out-outside-cwd]
 *
 * `--check` mode regenerates against the IDL but does NOT write — instead
 * it diffs against the on-disk files and exits 1 if drift is detected.
 * Suitable for CI guardrails.
 *
 * SECURITY (WARN-1): by default, `--out` MUST resolve under the current
 * working directory. Pass `--allow-out-outside-cwd` to opt out — useful
 * when generating into a sibling package, but the caller takes
 * responsibility for the trust boundary.
 *
 * Trust boundary: this CLI assumes the IDL JSON file and any
 * `--pubkey-overrides` sidecar are owned by the caller. No identifier in
 * either file is allowed through unvalidated; see `parser.ts` and the
 * runtime shape check below.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import {
  generateTypes,
  parseIdlJson,
  writeIfChanged,
  checkDrift,
  IdlParseError,
  type PubkeyOverrides,
  type PubkeyClassification,
} from './codegen';

const program = new Command();
program
  .name('arlex-cli')
  .description('Tooling for the @arlex/client TypeScript SDK')
  .version('0.2.0');

/**
 * Validate that `target` resolves inside `cwd`. Returns true if `target`
 * is `cwd` itself or any descendant. Symlink resolution is intentionally
 * NOT performed (we're guarding against accidental misuse, not a fully
 * sandboxed environment — callers running on attacker-controlled
 * filesystems should opt in via `--allow-out-outside-cwd` knowingly).
 */
function isUnderCwd(targetAbs: string, cwd: string): boolean {
  if (targetAbs === cwd) return true;
  return targetAbs.startsWith(cwd + path.sep);
}

/**
 * Runtime shape check for the `--pubkey-overrides` JSON (WARN-2).
 *
 * Expected shape: `{ [typeName: string]: { [fieldName: string]: 'publicKey' | 'bytes32' } }`
 * Throws `IdlParseError` with the offending path on the first violation.
 */
function validatePubkeyOverrides(value: unknown, file: string): PubkeyOverrides {
  const where = `pubkey-overrides ${JSON.stringify(file)}`;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IdlParseError(`${where}: top-level must be an object`);
  }
  const out: PubkeyOverrides = {};
  for (const [typeName, typeMap] of Object.entries(value as Record<string, unknown>)) {
    if (typeMap === null || typeof typeMap !== 'object' || Array.isArray(typeMap)) {
      throw new IdlParseError(`${where}: value for ${JSON.stringify(typeName)} must be an object`);
    }
    const inner: Record<string, PubkeyClassification> = {};
    for (const [fieldName, classification] of Object.entries(typeMap as Record<string, unknown>)) {
      if (classification !== 'publicKey' && classification !== 'bytes32') {
        throw new IdlParseError(
          `${where}: ${JSON.stringify(typeName)}.${JSON.stringify(fieldName)} must be ` +
          `'publicKey' or 'bytes32' (got ${JSON.stringify(classification)})`,
        );
      }
      inner[fieldName] = classification;
    }
    out[typeName] = inner;
  }
  return out;
}

program
  .command('generate-types <idl>')
  .description('Generate typed accounts/instructions/errors modules from an IDL JSON file')
  .requiredOption('--out <dir>', 'output directory for generated files')
  .option('--pubkey-overrides <file>', 'sidecar JSON with per-field pubkey/bytes32 overrides')
  .option('--program-name <name>', 'override IDL "name" used in banner / labels')
  .option('--check', 'do not write — exit 1 if generated output differs from on-disk files')
  .option(
    '--allow-out-outside-cwd',
    'permit --out to resolve outside the current working directory (default: refuse)',
  )
  .action(async (
    idlPath: string,
    opts: {
      out: string;
      pubkeyOverrides?: string;
      programName?: string;
      check?: boolean;
      allowOutOutsideCwd?: boolean;
    },
  ) => {
    try {
      const cwd = process.cwd();

      // WARN-1: gate --out against cwd unless explicitly opted out.
      const outDir = path.resolve(opts.out);
      if (!opts.allowOutOutsideCwd && !isUnderCwd(outDir, cwd)) {
        throw new Error(
          `--out resolves outside cwd: ${outDir}\n` +
          `cwd: ${cwd}\n` +
          `pass --allow-out-outside-cwd to override (callers take responsibility)`,
        );
      }

      // Input paths are also resolved; we accept absolute paths but emit a
      // warning when they fall outside cwd (lighter touch — they are
      // read-only and the caller usually points at vendored IDLs).
      const idlAbs = path.resolve(idlPath);
      if (!opts.allowOutOutsideCwd && !isUnderCwd(idlAbs, cwd)) {
        process.stderr.write(
          `warning: <idl> path is outside cwd: ${idlAbs}\n` +
          `         (read-only; pass --allow-out-outside-cwd to silence)\n`,
        );
      }

      const idlText = await fs.readFile(idlAbs, 'utf8');
      const idl = parseIdlJson(idlText);

      let overrides: PubkeyOverrides | undefined;
      if (opts.pubkeyOverrides) {
        const overridesAbs = path.resolve(opts.pubkeyOverrides);
        if (!opts.allowOutOutsideCwd && !isUnderCwd(overridesAbs, cwd)) {
          process.stderr.write(
            `warning: --pubkey-overrides path is outside cwd: ${overridesAbs}\n` +
            `         (read-only; pass --allow-out-outside-cwd to silence)\n`,
          );
        }
        const overrideText = await fs.readFile(overridesAbs, 'utf8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(overrideText);
        } catch (e) {
          throw new IdlParseError(
            `--pubkey-overrides ${JSON.stringify(overridesAbs)}: invalid JSON: ${(e as Error).message}`,
          );
        }
        // WARN-2: runtime shape check before trusting the value as PubkeyOverrides.
        overrides = validatePubkeyOverrides(parsed, overridesAbs);
      }

      const sources = generateTypes(idl, {
        pubkeyOverrides: overrides,
        programName: opts.programName,
      });

      const targets: Array<{ filename: string; source: string }> = [
        { filename: sources.filenames.accounts, source: sources.accounts },
        { filename: sources.filenames.instructions, source: sources.instructions },
        { filename: sources.filenames.errors, source: sources.errors },
      ];

      if (opts.check) {
        const drifts: string[] = [];
        for (const t of targets) {
          const filePath = path.join(outDir, t.filename);
          const drift = await checkDrift(filePath, t.source);
          if (drift) drifts.push(filePath);
        }
        if (drifts.length > 0) {
          process.stderr.write(`drift detected in ${drifts.length} file(s):\n`);
          for (const d of drifts) process.stderr.write(`  ${d}\n`);
          process.exit(1);
        }
        process.stdout.write(`no drift — ${targets.length} file(s) up to date\n`);
        return;
      }

      const results = [];
      for (const t of targets) {
        const filePath = path.join(outDir, t.filename);
        const result = await writeIfChanged(filePath, t.source);
        results.push(result);
        process.stdout.write(`${result.status === 'written' ? 'wrote' : 'skip '}  ${result.path}\n`);
      }
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`unhandled: ${(err as Error).message}\n`);
  process.exit(1);
});
