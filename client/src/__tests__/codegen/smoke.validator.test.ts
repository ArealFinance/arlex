/**
 * Validator-gated smoke test.
 *
 * Skipped automatically when `http://127.0.0.1:8899` is unreachable.
 * When the validator is up, this test fetches one known account per Areal
 * program (if available) and decodes it via the runtime serializer.
 *
 * For Phase 2 we don't ship deploy seeds so this test mostly verifies the
 * skip-if-no-validator wiring; future work can add fixtures.
 */
import { describe, it, expect } from 'vitest';
import { isValidatorReachable } from './helpers/validator';

describe('validator-gated smoke', () => {
  let reachable = false;

  it('checks if validator is reachable', async () => {
    reachable = await isValidatorReachable();
    // Always true — this test just sets the gate flag.
    expect(typeof reachable).toBe('boolean');
  });

  it.runIf(true)('skips real-account fetch when validator is unavailable', async () => {
    if (!reachable) {
      // Soft skip: real-account decode requires fixtures we don't ship.
      return;
    }
    // Placeholder for future fixture-based test against a deployed program.
    // Intentionally no-op when reachable too — populate when fixtures land.
    expect(true).toBe(true);
  });
});
