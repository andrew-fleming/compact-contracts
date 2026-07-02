import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../../../artifacts/MockEcdhMask/contract/index.js';

// The EcdhMask circuits are pure, so tests drive them directly via the compiled
// artifact's `pureCircuits` (no proof, no simulator needed).

// A recipient's secret scalar and their derived public key g^ek.
const EK = 111222333444555n;
const PK = ecMulGenerator(EK);

// A consumer-supplied domain-separation tag. Must match on encrypt/decrypt.
const domain = (label: string): Uint8Array => {
  const d = new Uint8Array(32);
  d.set(new TextEncoder().encode(label).slice(0, 32));
  return d;
};
const DOMAIN = domain('ecdh_mask_test');

describe('EcdhMask', () => {
  describe('encrypt / decrypt round-trip', () => {
    it('recovers the encrypted value', () => {
      const ciphertext = pureCircuits.encrypt(PK, 1000n, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, DOMAIN)).toBe(1000n);
    });

    it('round-trips zero', () => {
      const ciphertext = pureCircuits.encrypt(PK, 0n, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, DOMAIN)).toBe(0n);
    });

    it('round-trips a value far above 2^48 (no discrete-log bound)', () => {
      // This is the whole point of the ECDH mask: values are delivered
      // directly, so there is no BSGS table and no 2^48 cap.
      const big = 1n << 120n;
      const ciphertext = pureCircuits.encrypt(PK, big, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, DOMAIN)).toBe(big);
    });
  });

  describe('confidentiality / correctness properties', () => {
    it('distinct ephemerals yield distinct ciphertexts for the same value', () => {
      const c1 = pureCircuits.encrypt(PK, 1000n, 1n, DOMAIN);
      const c2 = pureCircuits.encrypt(PK, 1000n, 2n, DOMAIN);
      expect(c1.ct).not.toBe(c2.ct);
      expect(c1.ephemeralPk).not.toEqual(c2.ephemeralPk);
    });

    it('distinct values yield distinct ciphertexts under the same ephemeral', () => {
      const c1 = pureCircuits.encrypt(PK, 1000n, 5n, DOMAIN);
      const c2 = pureCircuits.encrypt(PK, 2000n, 5n, DOMAIN);
      expect(c1.ct).not.toBe(c2.ct);
    });

    it('does not recover the value under the wrong secret key', () => {
      const ciphertext = pureCircuits.encrypt(PK, 1000n, 42n, DOMAIN);
      const WRONG_EK = 999999n;
      expect(pureCircuits.decrypt(ciphertext, WRONG_EK, DOMAIN)).not.toBe(1000n);
    });

    it('does not recover the value under the wrong domain', () => {
      const ciphertext = pureCircuits.encrypt(PK, 1000n, 42n, DOMAIN);
      expect(pureCircuits.decrypt(ciphertext, EK, domain('other'))).not.toBe(
        1000n,
      );
    });
  });

  describe('kdf', () => {
    it('is deterministic for the same shared point and domain', () => {
      expect(pureCircuits.kdf(PK, DOMAIN)).toBe(pureCircuits.kdf(PK, DOMAIN));
    });

    it('differs for distinct shared points', () => {
      const other = ecMulGenerator(222n);
      expect(pureCircuits.kdf(PK, DOMAIN)).not.toBe(
        pureCircuits.kdf(other, DOMAIN),
      );
    });

    it('differs for distinct domains (domain separation)', () => {
      expect(pureCircuits.kdf(PK, domain('a'))).not.toBe(
        pureCircuits.kdf(PK, domain('b')),
      );
    });
  });
});
