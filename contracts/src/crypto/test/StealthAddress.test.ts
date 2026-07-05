import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../../../artifacts/MockStealthAddress/contract/index.js';

// Pure circuits, driven directly (no proof/simulator).

// Recipient meta-keys: scan secret s -> S = g^s, spend secret b -> B = g^b.
// Kept modest so the one-time spend scalar c + b stays a valid Jubjub scalar
// (see the module's scalar-reduction caveat).
const s = 111222333n;
const b = 444555666n;
const S = ecMulGenerator(s);
const B = ecMulGenerator(b);
const meta = { scanPk: S, spendPk: B };

describe('StealthAddress', () => {
  it('recipient DETECTS its own one-time address (scan matches)', () => {
    const ot = pureCircuits.deriveOneTime(meta, 777888999n);
    // Recipient recomputes the one-time pk from the ephemeral + scan secret.
    expect(pureCircuits.scan(ot.ephemeral, s, B)).toEqual(ot.oneTimePk);
  });

  it('recipient can SPEND it (g^(c+b) == oneTimePk)', () => {
    const ot = pureCircuits.deriveOneTime(meta, 777888999n);
    // The one-time spend pubkey derived from the spend secret equals the address.
    expect(pureCircuits.spendPk(ot.ephemeral, s, b)).toEqual(ot.oneTimePk);
  });

  it('a wrong scan secret does NOT detect the address (unlinkability)', () => {
    const ot = pureCircuits.deriveOneTime(meta, 777888999n);
    const wrongS = 999999999n;
    expect(pureCircuits.scan(ot.ephemeral, wrongS, B)).not.toEqual(
      ot.oneTimePk,
    );
  });

  it('distinct ephemerals yield distinct, unlinkable one-time addresses', () => {
    const ot1 = pureCircuits.deriveOneTime(meta, 111n);
    const ot2 = pureCircuits.deriveOneTime(meta, 222n);
    expect(ot1.oneTimePk).not.toEqual(ot2.oneTimePk);
    expect(ot1.ephemeral).not.toEqual(ot2.ephemeral);
    // Both are still detectable by the true recipient.
    expect(pureCircuits.scan(ot1.ephemeral, s, B)).toEqual(ot1.oneTimePk);
    expect(pureCircuits.scan(ot2.ephemeral, s, B)).toEqual(ot2.oneTimePk);
  });

  it('the scan key alone cannot spend (spend needs b, not just s)', () => {
    const ot = pureCircuits.deriveOneTime(meta, 777888999n);
    // Using the scan secret in place of the spend secret must not reproduce P.
    expect(pureCircuits.spendPk(ot.ephemeral, s, s)).not.toEqual(ot.oneTimePk);
  });

  // The scalar-reduction constraint and its witness-assisted fix.
  const L = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
  const bigB = L - 1000n; // a spend key large enough that c + b > L
  const bigMeta = { scanPk: S, spendPk: ecMulGenerator(bigB) };

  it('naive c+b FAULTS for a large spend key (the constraint)', () => {
    const ot = pureCircuits.deriveOneTime(bigMeta, 777888999n);
    // c + bigB > L, so ecMulGenerator(c + b) is not a valid Jubjub scalar.
    expect(() => pureCircuits.spendPk(ot.ephemeral, s, bigB)).toThrow();
  });

  it('witness-assisted mod-L reduction makes spend work for ANY spend key', () => {
    const ot = pureCircuits.deriveOneTime(bigMeta, 777888999n);
    // Wallet computes the reduction (q, p) off-chain from c and b.
    const c = pureCircuits.sharedScalarFor(ot.ephemeral, s);
    const sum = c + bigB;
    const q = sum >= L ? 1n : 0n;
    const p = sum - q * L;
    // Verified reduction reproduces the one-time address => spend works.
    expect(pureCircuits.spendPkReduced(ot.ephemeral, s, bigB, q, p)).toEqual(
      ot.oneTimePk,
    );
  });

  it('rejects a bad witnessed reduction (soundness)', () => {
    const ot = pureCircuits.deriveOneTime(bigMeta, 777888999n);
    const c = pureCircuits.sharedScalarFor(ot.ephemeral, s);
    const sum = c + bigB;
    const q = sum >= L ? 1n : 0n;
    const p = sum - q * L;
    // Tamper with p: the q*L + p == c + b check must fail.
    expect(() =>
      pureCircuits.spendPkReduced(ot.ephemeral, s, bigB, q, p + 1n),
    ).toThrow();
  });
});
