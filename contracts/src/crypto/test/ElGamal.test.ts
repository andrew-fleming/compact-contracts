import { describe, expect, it } from 'vitest';
import {
  type Ciphertext,
  ElGamalSimulator,
} from './simulators/ElGamalSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic 32-byte value seeded from a label, so every test input is
 * reproducible.
 */
const b32 = (label: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label).slice(0, 32));
  return out;
};

// Distinct secrets for two independent identities.
const EK_A = b32('elgamal-ek-A');
const EK_B = b32('elgamal-ek-B');

// Explicit encryption randomness. Any value below the Jubjub scalar field
// order (~2^252) is a valid scalar; these small constants keep the tests
// deterministic and let us assert that distinct randomness yields distinct
// ciphertexts. `expandRandomness` is exercised separately.
const R1 = 111n;
const R2 = 222n;
const R3 = 333n;

let contract: ElGamalSimulator;

describe('ElGamal', () => {
  contract = new ElGamalSimulator();

  const pkA = contract.derivePk(EK_A);
  const pkB = contract.derivePk(EK_B);

  // -------------------------------------------------------------------------
  // secretToScalar
  // -------------------------------------------------------------------------
  describe('secretToScalar', () => {
    it('is deterministic for the same secret', () => {
      expect(contract.secretToScalar(EK_A)).toBe(contract.secretToScalar(EK_A));
    });

    it('maps distinct secrets to distinct scalars', () => {
      expect(contract.secretToScalar(EK_A)).not.toBe(
        contract.secretToScalar(EK_B),
      );
    });

    it('returns a positive scalar', () => {
      expect(contract.secretToScalar(EK_A)).toBeGreaterThan(0n);
    });
  });

  // -------------------------------------------------------------------------
  // derivePk
  // -------------------------------------------------------------------------
  describe('derivePk', () => {
    it('is deterministic for the same secret', () => {
      expect(contract.derivePk(EK_A)).toEqual(contract.derivePk(EK_A));
    });

    it('maps distinct secrets to distinct public keys', () => {
      expect(contract.derivePk(EK_A)).not.toEqual(contract.derivePk(EK_B));
    });
  });

  // -------------------------------------------------------------------------
  // expandRandomness
  //
  // The anti-reuse guarantee: a single witness seed must yield independent
  // randomness per tag, and the wallet cannot collapse them.
  // -------------------------------------------------------------------------
  describe('expandRandomness', () => {
    const seed = b32('seed-0');
    const otherSeed = b32('seed-1');
    const tagX = b32('tag-x');
    const tagY = b32('tag-y');

    it('is deterministic for the same (seed, tag)', () => {
      expect(contract.expandRandomness(seed, tagX)).toBe(
        contract.expandRandomness(seed, tagX),
      );
    });

    it('produces distinct outputs for distinct tags under the same seed', () => {
      expect(contract.expandRandomness(seed, tagX)).not.toBe(
        contract.expandRandomness(seed, tagY),
      );
    });

    it('produces distinct outputs for distinct seeds under the same tag', () => {
      expect(contract.expandRandomness(seed, tagX)).not.toBe(
        contract.expandRandomness(otherSeed, tagX),
      );
    });
  });

  // -------------------------------------------------------------------------
  // encrypt + assertDecryptsTo (correctness of the core scheme)
  //
  // `assertDecryptsTo` is the decryption oracle for these tests: it succeeds
  // if `ct` decrypts under `(pk, ek)` to the claimed value.
  // -------------------------------------------------------------------------
  describe('encrypt / decryption round-trip', () => {
    it('decrypts to the encrypted value', () => {
      const ct = contract.encrypt(pkA, 100n, R1);
      expect(() =>
        contract.assertDecryptsTo(ct, pkA, EK_A, 100n),
      ).not.toThrow();
    });

    it('round-trips the zero value', () => {
      const ct = contract.encrypt(pkA, 0n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 0n)).not.toThrow();
    });

    it('rejects a wrong claimed plaintext', () => {
      const ct = contract.encrypt(pkA, 100n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 101n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });

    it('rejects an ek that does not match the public key', () => {
      const ct = contract.encrypt(pkA, 100n, R1);
      // EK_B derives pkB, not pkA, so the key-binding check fails first.
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_B, 100n)).toThrow(
        'ElGamal: ek/pk mismatch',
      );
    });

    it('rejects a public key the ek does not correspond to', () => {
      const ct = contract.encrypt(pkA, 100n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkB, EK_A, 100n)).toThrow(
        'ElGamal: ek/pk mismatch',
      );
    });

    it('is randomized: same plaintext under different randomness yields different ciphertexts', () => {
      const ct1 = contract.encrypt(pkA, 100n, R1);
      const ct2 = contract.encrypt(pkA, 100n, R2);
      expect(ct1).not.toEqual(ct2);
      // ...yet both decrypt to the same value.
      expect(() =>
        contract.assertDecryptsTo(ct1, pkA, EK_A, 100n),
      ).not.toThrow();
      expect(() =>
        contract.assertDecryptsTo(ct2, pkA, EK_A, 100n),
      ).not.toThrow();
    });

    it('binds a ciphertext to its recipient key (no cross-key decryption)', () => {
      // A ciphertext for pkA must not decrypt to its plaintext under B's key,
      // even though (pkB, EK_B) is internally consistent.
      const ct = contract.encrypt(pkA, 100n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkB, EK_B, 100n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // encryptPoint / assertDecryptsToPoint (general, non-lifted ElGamal)
  //
  // Message points are arbitrary prime-order-subgroup points; we reuse derived
  // public keys as convenient subgroup points to encrypt.
  // -------------------------------------------------------------------------
  describe('encryptPoint / assertDecryptsToPoint', () => {
    const m1 = pkB; // an arbitrary subgroup point
    const m2 = contract.derivePk(b32('msg-point-2'));

    it('round-trips an arbitrary message point', () => {
      const ct = contract.encryptPoint(pkA, m1, R1);
      expect(() =>
        contract.assertDecryptsToPoint(ct, pkA, EK_A, m1),
      ).not.toThrow();
    });

    it('rejects a wrong claimed message point', () => {
      const ct = contract.encryptPoint(pkA, m1, R1);
      expect(() => contract.assertDecryptsToPoint(ct, pkA, EK_A, m2)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });

    it('rejects an ek that does not match the public key', () => {
      const ct = contract.encryptPoint(pkA, m1, R1);
      expect(() => contract.assertDecryptsToPoint(ct, pkA, EK_B, m1)).toThrow(
        'ElGamal: ek/pk mismatch',
      );
    });

    it('lifted encrypt is the special case encryptPoint(pk, g^value, r)', () => {
      // g^0 is the curve identity, which encryptZero exposes as its c1.
      const idPoint = contract.encryptZero().c1;
      const lifted = contract.encrypt(pkA, 0n, R1);
      expect(() =>
        contract.assertDecryptsToPoint(lifted, pkA, EK_A, idPoint),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // encryptZero
  // -------------------------------------------------------------------------
  describe('encryptZero', () => {
    it('decrypts to 0 under a valid key pair', () => {
      const ct = contract.encryptZero();
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 0n)).not.toThrow();
    });

    it('does not decrypt to a nonzero value', () => {
      const ct = contract.encryptZero();
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 1n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });

    it('is the canonical (non-randomized) identity ciphertext', () => {
      expect(contract.encryptZero()).toEqual(contract.encryptZero());
    });
  });

  // -------------------------------------------------------------------------
  // addEncrypted (additive homomorphism)
  // -------------------------------------------------------------------------
  describe('addEncrypted', () => {
    it('adds to the encrypted plaintext: Enc(a) + b decrypts to a + b', () => {
      const ct = contract.addEncrypted(
        contract.encrypt(pkA, 40n, R1),
        pkA,
        2n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 42n)).not.toThrow();
    });

    it('adding to the identity yields the added value', () => {
      const ct = contract.addEncrypted(contract.encryptZero(), pkA, 75n, R1);
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 75n)).not.toThrow();
    });

    it('adding 0 preserves the plaintext but rerandomizes the ciphertext', () => {
      const base = contract.encrypt(pkA, 40n, R1);
      const added = contract.addEncrypted(base, pkA, 0n, R2);
      expect(added).not.toEqual(base);
      expect(() =>
        contract.assertDecryptsTo(added, pkA, EK_A, 40n),
      ).not.toThrow();
    });

    it('rejects a wrong claimed sum', () => {
      const ct = contract.addEncrypted(
        contract.encrypt(pkA, 40n, R1),
        pkA,
        2n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 43n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // subEncrypted (additive homomorphism, subtraction)
  // -------------------------------------------------------------------------
  describe('subEncrypted', () => {
    it('subtracts from the encrypted plaintext: Enc(a) - b decrypts to a - b', () => {
      const ct = contract.subEncrypted(
        contract.encrypt(pkA, 50n, R1),
        pkA,
        8n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 42n)).not.toThrow();
    });

    it('subtracting the full balance decrypts to 0', () => {
      const ct = contract.subEncrypted(
        contract.encrypt(pkA, 50n, R1),
        pkA,
        50n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 0n)).not.toThrow();
    });

    it('rejects a wrong claimed difference', () => {
      const ct = contract.subEncrypted(
        contract.encrypt(pkA, 50n, R1),
        pkA,
        8n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 41n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });

    it('does NOT guard against underflow (caller must check the plaintext)', () => {
      // Subtracting more than the balance produces a ciphertext of a - b taken
      // modulo the curve order — a huge value, not a clamped 0. This documents
      // the contract: callers must assert sufficiency of the plaintext first.
      const ct = contract.subEncrypted(
        contract.encrypt(pkA, 5n, R1),
        pkA,
        10n,
        R2,
      );
      expect(() => contract.assertDecryptsTo(ct, pkA, EK_A, 0n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // negate (componentwise ciphertext negation)
  // -------------------------------------------------------------------------
  describe('negate', () => {
    it('a ciphertext plus its negation decrypts to 0', () => {
      const ct = contract.encrypt(pkA, 30n, R1);
      const zero = contract.add(ct, contract.negate(ct));
      expect(() =>
        contract.assertDecryptsTo(zero, pkA, EK_A, 0n),
      ).not.toThrow();
    });

    it('negating twice round-trips to the original plaintext', () => {
      const ct = contract.encrypt(pkA, 30n, R1);
      const back = contract.negate(contract.negate(ct));
      expect(() =>
        contract.assertDecryptsTo(back, pkA, EK_A, 30n),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // add (homomorphic addition of two ciphertexts)
  // -------------------------------------------------------------------------
  describe('add', () => {
    it('Enc(a) + Enc(b) decrypts to a + b', () => {
      const sum = contract.add(
        contract.encrypt(pkA, 40n, R1),
        contract.encrypt(pkA, 2n, R2),
      );
      expect(() =>
        contract.assertDecryptsTo(sum, pkA, EK_A, 42n),
      ).not.toThrow();
    });

    it('adding the identity ciphertext preserves the plaintext', () => {
      const base = contract.encrypt(pkA, 40n, R1);
      const sum = contract.add(base, contract.encryptZero());
      expect(() =>
        contract.assertDecryptsTo(sum, pkA, EK_A, 40n),
      ).not.toThrow();
    });

    it('does not combine across recipient keys (result opens under neither)', () => {
      // Enc_A(10) + Enc_B(5) is not a valid ciphertext under either key.
      const mixed = contract.add(
        contract.encrypt(pkA, 10n, R1),
        contract.encrypt(pkB, 5n, R2),
      );
      expect(() => contract.assertDecryptsTo(mixed, pkA, EK_A, 15n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
      expect(() => contract.assertDecryptsTo(mixed, pkB, EK_B, 15n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // sub (homomorphic subtraction of two ciphertexts)
  // -------------------------------------------------------------------------
  describe('sub', () => {
    it('Enc(a) - Enc(b) decrypts to a - b', () => {
      const diff = contract.sub(
        contract.encrypt(pkA, 50n, R1),
        contract.encrypt(pkA, 8n, R2),
      );
      expect(() =>
        contract.assertDecryptsTo(diff, pkA, EK_A, 42n),
      ).not.toThrow();
    });

    it('subtracting an equal-value ciphertext decrypts to 0', () => {
      const diff = contract.sub(
        contract.encrypt(pkA, 50n, R1),
        contract.encrypt(pkA, 50n, R2),
      );
      expect(() =>
        contract.assertDecryptsTo(diff, pkA, EK_A, 0n),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // scalarMul (homomorphic multiplication by a public scalar)
  // -------------------------------------------------------------------------
  describe('scalarMul', () => {
    it('scales the plaintext: k * Enc(v) decrypts to k * v', () => {
      const scaled = contract.scalarMul(contract.encrypt(pkA, 6n, R1), 7n);
      expect(() =>
        contract.assertDecryptsTo(scaled, pkA, EK_A, 42n),
      ).not.toThrow();
    });

    it('scaling by 1 preserves the plaintext', () => {
      const scaled = contract.scalarMul(contract.encrypt(pkA, 40n, R1), 1n);
      expect(() =>
        contract.assertDecryptsTo(scaled, pkA, EK_A, 40n),
      ).not.toThrow();
    });

    it('scaling by 0 decrypts to 0', () => {
      const scaled = contract.scalarMul(contract.encrypt(pkA, 40n, R1), 0n);
      expect(() =>
        contract.assertDecryptsTo(scaled, pkA, EK_A, 0n),
      ).not.toThrow();
    });

    it('composes with add into a weighted sum: 3a + 5b', () => {
      // 3*4 + 5*6 = 42
      const weighted = contract.add(
        contract.scalarMul(contract.encrypt(pkA, 4n, R1), 3n),
        contract.scalarMul(contract.encrypt(pkA, 6n, R2), 5n),
      );
      expect(() =>
        contract.assertDecryptsTo(weighted, pkA, EK_A, 42n),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // rerandomize (same plaintext, fresh randomness, unlinkable ciphertext)
  // -------------------------------------------------------------------------
  describe('rerandomize', () => {
    it('produces a different ciphertext that decrypts to the same value', () => {
      const base = contract.encrypt(pkA, 40n, R1);
      const fresh = contract.rerandomize(base, pkA, R2);
      expect(fresh).not.toEqual(base);
      expect(() =>
        contract.assertDecryptsTo(fresh, pkA, EK_A, 40n),
      ).not.toThrow();
    });

    it('distinct randomness yields distinct rerandomizations', () => {
      const base = contract.encrypt(pkA, 40n, R1);
      expect(contract.rerandomize(base, pkA, R2)).not.toEqual(
        contract.rerandomize(base, pkA, R3),
      );
    });
  });

  // -------------------------------------------------------------------------
  // assertKeyPair (standalone key-ownership check)
  // -------------------------------------------------------------------------
  describe('assertKeyPair', () => {
    it('accepts a matching (pk, ek) pair', () => {
      expect(() => contract.assertKeyPair(pkA, EK_A)).not.toThrow();
    });

    it('rejects an ek that does not derive the public key', () => {
      expect(() => contract.assertKeyPair(pkA, EK_B)).toThrow(
        'ElGamal: ek/pk mismatch',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Composed flow
  //
  // Exercises a typical running-balance sequence: start from a fresh balance,
  // add twice, subtract once, and confirm the running plaintext.
  // -------------------------------------------------------------------------
  describe('composed balance flow', () => {
    it('tracks a running balance through add/add/sub', () => {
      let bal: Ciphertext = contract.encryptZero();
      bal = contract.addEncrypted(bal, pkA, 100n, R1); // add 100
      bal = contract.addEncrypted(bal, pkA, 30n, R2); // add 30
      bal = contract.subEncrypted(bal, pkA, 45n, R3); // subtract 45
      expect(() =>
        contract.assertDecryptsTo(bal, pkA, EK_A, 85n),
      ).not.toThrow();
      // And the intermediate-wrong value is rejected.
      expect(() => contract.assertDecryptsTo(bal, pkA, EK_A, 130n)).toThrow(
        'ElGamal: plaintext mismatch',
      );
    });
  });

  describe('simulator wiring', () => {
    it('exposes an empty public ledger via getPublicState', () => {
      expect(contract.getPublicState()).toStrictEqual({});
    });
  });
});
