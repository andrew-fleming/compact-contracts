import { beforeEach, describe, expect, it } from 'vitest';
import { BlocklistSimulator } from './simulators/BlocklistSimulator.js';

// Deterministic 32-byte account identifier seeded from a label.
const account = (label: string): Uint8Array => {
  const a = new Uint8Array(32);
  a.set(new TextEncoder().encode(label).slice(0, 32));
  return a;
};

const ALICE = account('ALICE');
const BOB = account('BOB');

let blocklist: BlocklistSimulator;

describe('Blocklist', () => {
  beforeEach(() => {
    blocklist = new BlocklistSimulator();
  });

  describe('default state', () => {
    it('is empty: no account is blocked', () => {
      expect(blocklist.isBlocked(ALICE)).toBe(false);
      expect(blocklist.isBlocked(BOB)).toBe(false);
    });

    it('assertNotBlocked passes for a non-member', () => {
      expect(() => blocklist.assertNotBlocked(ALICE)).not.toThrow();
    });
  });

  describe('block', () => {
    it('adds an account to the blocklist', () => {
      blocklist.block(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(true);
    });

    it('does not affect other accounts', () => {
      blocklist.block(ALICE);
      expect(blocklist.isBlocked(BOB)).toBe(false);
    });

    it('assertNotBlocked throws for a member', () => {
      blocklist.block(ALICE);
      expect(() => blocklist.assertNotBlocked(ALICE)).toThrow(
        'Blocklist: account blocked',
      );
    });

    it('is idempotent', () => {
      blocklist.block(ALICE);
      blocklist.block(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(true);
    });

    it('clears with a single unblock after being blocked multiple times', () => {
      blocklist.block(ALICE);
      blocklist.block(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(true);
      blocklist.unblock(ALICE);
      // Membership is binary, not a counter: one unblock clears it regardless
      // of how many times it was blocked.
      expect(blocklist.isBlocked(ALICE)).toBe(false);
    });
  });

  describe('unblock', () => {
    it('removes an account from the blocklist', () => {
      blocklist.block(ALICE);
      blocklist.unblock(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(false);
    });

    it('assertNotBlocked passes again after unblock', () => {
      blocklist.block(ALICE);
      blocklist.unblock(ALICE);
      expect(() => blocklist.assertNotBlocked(ALICE)).not.toThrow();
    });

    it('is a no-op for a non-member', () => {
      blocklist.unblock(BOB);
      expect(blocklist.isBlocked(BOB)).toBe(false);
    });
  });

  describe('multiple operations', () => {
    it('handles block -> unblock -> block', () => {
      blocklist.block(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(true);

      blocklist.unblock(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(false);

      blocklist.block(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(true);
    });

    it('tracks several accounts independently', () => {
      blocklist.block(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(true);
      expect(blocklist.isBlocked(BOB)).toBe(false);

      blocklist.block(BOB);
      blocklist.unblock(ALICE);
      expect(blocklist.isBlocked(ALICE)).toBe(false);
      expect(blocklist.isBlocked(BOB)).toBe(true);
    });
  });

  describe('simulator wiring', () => {
    it('exposes the public ledger via getPublicState', () => {
      const sim = new BlocklistSimulator();

      expect(sim.getPublicState().Blocklist__blocked.member(ALICE)).toBe(false);

      sim.block(ALICE);

      expect(sim.getPublicState().Blocklist__blocked.member(ALICE)).toBe(true);
    });
  });
});
