import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashMessage } from 'ethers';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { signerFromLabel } from '#test-utils/fixtures/ecdsa.js';
import { Eip191Simulator } from './simulators/Eip191Simulator.js';

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

// `ethers.hashMessage` is the oracle throughout: an implementation of EIP-191
// written by neither this module nor this spec, so agreement is evidence about
// the standard rather than about our own reading of it. It returns a `0x`
// prefixed string.
const ethersDigest = (message: Uint8Array): string =>
  hashMessage(message).slice(2);

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const b32 = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

let contract: Eip191Simulator;

describe('Eip191', () => {
  beforeAll(async () => {
    contract = await Eip191Simulator.create();
  });

  describe('personalSignHash', () => {
    it('matches ethers.hashMessage', async () => {
      expect(hex(await contract.personalSignHash(b32(0x7a)))).toEqual(
        ethersDigest(b32(0x7a)),
      );
    });

    // Spells out the construction ethers performs, so the prefix this module
    // commits to is legible here rather than only inside a dependency. Also a
    // canary: if a future ethers changed how it treats a 32-byte message, this
    // would still hold while the oracle tests diverged.
    it('uses the exact 28-byte prefix', async () => {
      const prefix = Buffer.from('\x19Ethereum Signed Message:\n32', 'binary');

      expect(prefix.length).toEqual(28);
      expect(prefix.toString('hex')).toEqual(
        '19457468657265756d205369676e6564204d6573736167653a0a3332',
      );
      expect(hex(await contract.personalSignHash(b32(0)))).toEqual(
        hex(keccak_256(Buffer.concat([prefix, Buffer.alloc(32)]))),
      );
    });

    it('is not the bare message hash', async () => {
      const inner = b32(0x42);

      expect(hex(await contract.personalSignHash(inner))).not.toEqual(
        hex(inner),
      );
    });

    it('differs for differing messages', async () => {
      expect(hex(await contract.personalSignHash(b32(1)))).not.toEqual(
        hex(await contract.personalSignHash(b32(2))),
      );
    });

    it('agrees with ethers across arbitrary messages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (bytes) => {
            const m = Uint8Array.from(bytes);
            expect(hex(await contract.personalSignHash(m))).toEqual(
              ethersDigest(m),
            );
          },
        ),
        { numRuns: 32 },
      );
    });

    // The point of the envelope: a signature an EVM signer produced over
    // `personal_sign` must verify against this digest and not against the bare
    // message hash. The signed digest comes from ethers, so this is not a
    // signature over a value this spec computed.
    it('produces the digest an EVM personal_sign signature verifies against', async () => {
      const signer = signerFromLabel('eip191-envelope');
      const message = b32(0x7a);

      const digest = Buffer.from(ethersDigest(message), 'hex');
      const sig = secp256k1.sign(digest, signer.secretKey, {
        prehash: false,
        lowS: true,
      });

      const pk = secp256k1.getPublicKey(signer.secretKey, false);
      const onChain = await contract.personalSignHash(message);

      expect(hex(onChain)).toEqual(hex(digest));
      expect(secp256k1.verify(sig, onChain, pk, { prehash: false })).toBe(true);
      expect(secp256k1.verify(sig, message, pk, { prehash: false })).toBe(
        false,
      );
    });
  });
});
