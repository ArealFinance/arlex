/**
 * Idempotence test — running the codegen against the same IDL twice
 * MUST produce byte-identical output. This guards against accidentally
 * introducing timestamps, non-deterministic Map iteration order, etc.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { generateTypes, parseIdlJson } from '../../codegen';

const fixturesDir = path.join(__dirname, 'fixtures');
const arealIdlDir = '/Users/blackmesa/Documents/areal.newera/dashboard/src/lib/idl';

function fixtureFiles(): string[] {
  try {
    return readdirSync(fixturesDir).filter(f => f.endsWith('.json')).map(f => path.join(fixturesDir, f));
  } catch {
    return [];
  }
}

function arealFiles(): string[] {
  try {
    return readdirSync(arealIdlDir).filter(f => f.endsWith('.json')).map(f => path.join(arealIdlDir, f));
  } catch {
    return [];
  }
}

const allIdls = [...fixtureFiles(), ...arealFiles()];

describe('codegen idempotence', () => {
  for (const file of allIdls) {
    const label = path.basename(file);
    it(`${label}: regenerating yields byte-identical output`, () => {
      const idlText = readFileSync(file, 'utf8');
      const idl1 = parseIdlJson(idlText);
      const idl2 = parseIdlJson(idlText);
      const a = generateTypes(idl1);
      const b = generateTypes(idl2);
      expect(b.accounts).toBe(a.accounts);
      expect(b.instructions).toBe(a.instructions);
      expect(b.errors).toBe(a.errors);
      // Phase 3.5 C.2 — defined-types.generated.ts must also be deterministic.
      expect(b.definedTypes).toBe(a.definedTypes);
    });
  }

  it('generated source contains no timestamp markers', () => {
    if (allIdls.length === 0) return;
    const idl = parseIdlJson(readFileSync(allIdls[0], 'utf8'));
    const out = generateTypes(idl);
    for (const src of [out.accounts, out.instructions, out.errors, out.definedTypes]) {
      // Forbid common timestamp markers (ISO date / UNIX seconds-ish)
      expect(src).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(src).not.toMatch(/Generated at:/i);
    }
  });
});
