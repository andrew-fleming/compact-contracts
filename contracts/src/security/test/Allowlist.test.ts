import { beforeEach, describe, expect, it } from 'vitest';
import { AllowlistSimulator } from './simulators/AllowlistSimulator.js';

// Deterministic 32-byte account identifier seeded from a label.
const account = (label: string): Uint8Array => {
  const a = new Uint8Array(32);
  a.set(new TextEncoder().encode(label).slice(0, 32));
  return a;
};

const ALICE = account('ALICE');
const BOB = account('BOB');

let allowlist: AllowlistSimulator;

describe('Allowlist', () => {
  beforeEach(() => {
    allowlist = new AllowlistSimulator();
  });

  describe('default state', () => {
    it('is empty: no account is allowed', () => {
      expect(allowlist.isAllowed(ALICE)).toBe(false);
      expect(allowlist.isAllowed(BOB)).toBe(false);
    });

    it('assertAllowed throws for a non-member', () => {
      expect(() => allowlist.assertAllowed(ALICE)).toThrow(
        'Allowlist: account not allowed',
      );
    });
  });

  describe('allow', () => {
    it('adds an account to the allowlist', () => {
      allowlist.allow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(true);
    });

    it('does not affect other accounts', () => {
      allowlist.allow(ALICE);
      expect(allowlist.isAllowed(BOB)).toBe(false);
    });

    it('assertAllowed passes for a member', () => {
      allowlist.allow(ALICE);
      expect(() => allowlist.assertAllowed(ALICE)).not.toThrow();
    });

    it('is idempotent', () => {
      allowlist.allow(ALICE);
      allowlist.allow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(true);
    });

    it('clears with a single disallow after being allowed multiple times', () => {
      allowlist.allow(ALICE);
      allowlist.allow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(true);
      allowlist.disallow(ALICE);
      // Membership is binary, not a counter: one disallow clears it regardless
      // of how many times it was allowed.
      expect(allowlist.isAllowed(ALICE)).toBe(false);
    });
  });

  describe('disallow', () => {
    it('removes an account from the allowlist', () => {
      allowlist.allow(ALICE);
      allowlist.disallow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(false);
    });

    it('assertAllowed throws again after disallow', () => {
      allowlist.allow(ALICE);
      allowlist.disallow(ALICE);
      expect(() => allowlist.assertAllowed(ALICE)).toThrow(
        'Allowlist: account not allowed',
      );
    });

    it('is a no-op for a non-member', () => {
      allowlist.disallow(BOB);
      expect(allowlist.isAllowed(BOB)).toBe(false);
    });
  });

  describe('multiple operations', () => {
    it('handles allow -> disallow -> allow', () => {
      allowlist.allow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(true);

      allowlist.disallow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(false);

      allowlist.allow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(true);
    });

    it('tracks several accounts independently', () => {
      allowlist.allow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(true);
      expect(allowlist.isAllowed(BOB)).toBe(false);

      allowlist.allow(BOB);
      allowlist.disallow(ALICE);
      expect(allowlist.isAllowed(ALICE)).toBe(false);
      expect(allowlist.isAllowed(BOB)).toBe(true);
    });
  });

  describe('simulator wiring', () => {
    it('exposes the public ledger via getPublicState', () => {
      const sim = new AllowlistSimulator();

      expect(sim.getPublicState().Allowlist__allowed.member(ALICE)).toBe(false);

      sim.allow(ALICE);

      expect(sim.getPublicState().Allowlist__allowed.member(ALICE)).toBe(true);
    });
  });
});
