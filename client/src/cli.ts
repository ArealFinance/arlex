#!/usr/bin/env node
/**
 * arlex-cli — command-line interface for @arlex/client.
 *
 * Currently supports a single subcommand:
 *   generate-types <idl> --out <dir>
 *       [--pubkey-overrides <file>]
 *       [--program-name <name>]
 *       [--check]
 *
 * `--check` mode regenerates against the IDL but does NOT write — instead
 * it diffs against the on-disk files and exits 1 if drift is detected.
 * Suitable for CI guardrails.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { generateTypes, parseIdlJson, writeIfChanged, checkDrift, type PubkeyOverrides } from './codegen';

const program = new Command();
program
  .name('arlex-cli')
  .description('Tooling for the @arlex/client TypeScript SDK')
  .version('0.2.0');

program
  .command('generate-types <idl>')
  .description('Generate typed accounts/instructions/errors modules from an IDL JSON file')
  .requiredOption('--out <dir>', 'output directory for generated files')
  .option('--pubkey-overrides <file>', 'sidecar JSON with per-field pubkey/bytes32 overrides')
  .option('--program-name <name>', 'override IDL "name" used in banner / labels')
  .option('--check', 'do not write — exit 1 if generated output differs from on-disk files')
  .action(async (idlPath: string, opts: { out: string; pubkeyOverrides?: string; programName?: string; check?: boolean }) => {
    try {
      const idlText = await fs.readFile(idlPath, 'utf8');
      const idl = parseIdlJson(idlText);

      let overrides: PubkeyOverrides | undefined;
      if (opts.pubkeyOverrides) {
        const overrideText = await fs.readFile(opts.pubkeyOverrides, 'utf8');
        overrides = JSON.parse(overrideText) as PubkeyOverrides;
      }

      const sources = generateTypes(idl, {
        pubkeyOverrides: overrides,
        programName: opts.programName,
      });

      const outDir = path.resolve(opts.out);
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
