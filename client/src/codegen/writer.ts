/**
 * Idempotent file write helpers for codegen output.
 *
 * The writer is responsible for:
 *   - Stable, deterministic output (no timestamps, sorted keys upstream).
 *   - Header banner with IDL version + generator version.
 *   - Skipping the write when the file is already byte-identical.
 *   - Returning a manifest of what was written / unchanged for `--check`.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

/** Generator version bumped independently of @arlex/client package version. */
export const GENERATOR_VERSION = '1';

export interface BannerInput {
  idlName: string;
  idlVersion: string;
}

/**
 * Build the standard "DO NOT EDIT" banner.
 *
 * Intentionally NO timestamp — output must be deterministic so that
 * regenerating against the same IDL produces byte-identical files.
 */
export function buildBanner(input: BannerInput): string {
  return [
    '// AUTO-GENERATED — DO NOT EDIT',
    `// IDL: ${input.idlName} v${input.idlVersion}`,
    `// Generator: @arlex/client codegen v${GENERATOR_VERSION}`,
    '',
    '',
  ].join('\n');
}

export interface WriteResult {
  path: string;
  status: 'written' | 'unchanged';
}

/**
 * Write `content` to `filePath` only if it differs from the current contents.
 * Creates parent directories as needed. Returns whether the file was written.
 */
export async function writeIfChanged(filePath: string, content: string): Promise<WriteResult> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let existing: string | null = null;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (existing === content) {
    return { path: filePath, status: 'unchanged' };
  }
  await fs.writeFile(filePath, content, 'utf8');
  return { path: filePath, status: 'written' };
}

/**
 * Compare `content` against the current contents of `filePath`.
 * Used by `--check` mode. Returns true if drift was detected.
 */
export async function checkDrift(filePath: string, content: string): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return existing !== content;
}

/** Generated file suffix — `.generated.ts` per architect plan. */
export const GENERATED_SUFFIX = '.generated.ts';

/** Build a generated filename from a logical kind. */
export function generatedFilename(kind: 'accounts' | 'instructions' | 'errors'): string {
  return `${kind}${GENERATED_SUFFIX}`;
}
