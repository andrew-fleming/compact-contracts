import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { pureCircuits as elgamal } from '../../../artifacts/MockElGamal/contract/index.js';
import { pureCircuits as stealth } from '../../../artifacts/MockStealthAddress/contract/index.js';
import { StealthConfidentialTokenSimulator } from './simulators/StealthConfidentialTokenSimulator.js';

const testKey = (label: string): Uint8Array => {
  const k = new Uint8Array(32);
  k.set(new TextEncoder().encode(label).slice(0, 32));
  return k;
};

// Recipient meta-address seeds, and the sender's per-payment ephemeral seed.
const SCAN = testKey('RECIPIENT_SCAN');
const SPEND = testKey('RECIPIENT_SPEND');
const EPH = testKey('SENDER_EPHEMERAL');

const identity = () => ecMulGenerator(0n);
// Recompute the recipient's view exactly as the circuit derives it.
const scanScalar = () => elgamal.secretToScalar(SCAN);
const spendPk = () => ecMulGenerator(elgamal.secretToScalar(SPEND));

let sct: StealthConfidentialTokenSimulator;

describe('StealthConfidentialToken: recipient hiding (tier 2)', () => {
  beforeEach(async () => {
    sct = await StealthConfidentialTokenSimulator.create();
    await sct.privateState.setSeeds(SCAN, SPEND, EPH);
  });

  it('mints to a one-time address the recipient can DETECT and SPEND', async () => {
    const metaId = await sct.registerMeta();
    await sct.stealthMint(metaId, 1000n);

    // The on-chain output: an ephemeral + a one-time accountId unlinkable to meta.
    const state = await sct.getPublicState();
    const output = [...state.SCT__outputs][0];
    expect(state.SCT__totalSupply).toBe(1000n);

    // DETECTION: the recipient recomputes the one-time key from the ephemeral and
    // its scan secret, and it matches the stored one-time pubkey for that account.
    const recomputed = stealth.scan(output.ephemeral, scanScalar(), spendPk());
    const stored = state.SCT__pubkeys.lookup(output.accountId);
    expect(recomputed).toEqual(stored);

    // SPEND: the recipient claims the output (proves ownership + solvency, burns).
    await sct.privateState.cachePlaintext(
      await sct.balanceOf(output.accountId),
      1000n,
    );
    await sct.stealthClaim(output.ephemeral, output.accountId);

    const after = await sct.getPublicState();
    expect((await sct.balanceOf(output.accountId)).c1).toEqual(identity());
    expect(after.SCT__totalSupply).toBe(0n);
  });

  it('a different recipient cannot detect or claim the output (unlinkability)', async () => {
    const metaId = await sct.registerMeta();
    await sct.stealthMint(metaId, 500n);
    const output = [...(await sct.getPublicState()).SCT__outputs][0];

    // Wrong scan secret -> does not recompute the stored one-time key.
    const wrongScan = elgamal.secretToScalar(testKey('ATTACKER_SCAN'));
    const stored = (await sct.getPublicState()).SCT__pubkeys.lookup(
      output.accountId,
    );
    expect(stealth.scan(output.ephemeral, wrongScan, spendPk())).not.toEqual(
      stored,
    );

    // Wrong meta-secrets -> claim's ownership assertion fails.
    await sct.privateState.setSeeds(
      testKey('ATTACKER_SCAN'),
      testKey('ATTACKER_SPEND'),
      EPH,
    );
    await sct.privateState.cachePlaintext(
      await sct.balanceOf(output.accountId),
      500n,
    );
    await expect(
      sct.stealthClaim(output.ephemeral, output.accountId),
    ).rejects.toThrow('not the owner');
  });

  it('two payments to the same meta yield distinct, unlinkable outputs', async () => {
    const metaId = await sct.registerMeta();
    await sct.stealthMint(metaId, 100n);
    // Rotate the ephemeral so the second output uses a fresh one-time address.
    await sct.privateState.setSeeds(SCAN, SPEND, testKey('SENDER_EPHEMERAL_2'));
    await sct.stealthMint(metaId, 200n);

    const outputs = [...(await sct.getPublicState()).SCT__outputs];
    expect(outputs.length).toBe(2);
    expect(outputs[0].accountId).not.toEqual(outputs[1].accountId);
    expect(outputs[0].ephemeral).not.toEqual(outputs[1].ephemeral);
    // Both are detectable by the true recipient.
    for (const o of outputs) {
      expect(stealth.scan(o.ephemeral, scanScalar(), spendPk())).toEqual(
        (await sct.getPublicState()).SCT__pubkeys.lookup(o.accountId),
      );
    }
  });
});
