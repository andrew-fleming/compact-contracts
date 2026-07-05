import {
  CompactTypeBytes,
  ecMulGenerator,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { pureCircuits as ecdhMask } from '../../../artifacts/MockEcdhMask/contract/index.js';
import { HybridConfidentialTokenSimulator } from './simulators/HybridConfidentialTokenSimulator.js';

const padTag = (s: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(s));
  return b;
};

const bytes = (label: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(label).slice(0, 32));
  return b;
};

// pk = H(sk), mirroring the circuit's derivePk = persistentHash<Bytes<32>>(sk).
const pkOf = (sk: Uint8Array): Uint8Array =>
  persistentHash(new CompactTypeBytes(32), sk);

const SK_A = bytes('ALICE_SK');
const SK_B = bytes('BOB_SK');
const SK_C = bytes('CAROL_SK');
const PK_A = pkOf(SK_A);
const PK_B = pkOf(SK_B);
const PK_C = pkOf(SK_C);
const SK_AUTH = bytes('AUTHORITY_SK');
const SK_REC = bytes('RECOVERY_SK');
const PK_AUTH = pkOf(SK_AUTH);
const PK_REC = pkOf(SK_REC);

// Distinct note nonces.
const N1 = bytes('NONCE_1');
const N2 = bytes('NONCE_2');
const N3 = bytes('NONCE_3');
const N4 = bytes('NONCE_4');
const N5 = bytes('NONCE_5');
const N6 = bytes('NONCE_6');
const N7 = bytes('NONCE_7');

let hct: HybridConfidentialTokenSimulator;

describe('HybridConfidentialToken: notes / full graph privacy (tier 4)', () => {
  beforeEach(async () => {
    hct = await HybridConfidentialTokenSimulator.create();
  });

  it('mint -> private transfer -> recipient re-spends, with double-spend guard', async () => {
    // Mint 1000 to Alice as a note with nonce N1.
    await hct.privateState.set({ outNonce: N1 });
    await hct.mint(PK_A, 1000n);
    expect((await hct.getPublicState()).HCT__totalSupply).toBe(1000n);

    // Alice privately transfers 400 to Bob (change 600 back to Alice). A success
    // here proves membership + nullifier + conservation all work end to end.
    await hct.privateState.set({
      secretKey: SK_A,
      inputNote: { value: 1000n, nonce: N1 },
      outNonce: N2,
      changeNonce: N3,
    });
    await hct.transfer(PK_B, 400n);
    expect((await hct.getPublicState()).HCT__totalSupply).toBe(1000n); // conserved

    // Bob re-spends the note he received (400, N2) -> Carol. This proves a
    // received note is spendable, i.e. the full round-trip closes.
    await hct.privateState.set({
      secretKey: SK_B,
      inputNote: { value: 400n, nonce: N2 },
      outNonce: N4,
      changeNonce: N5,
    });
    await hct.transfer(PK_C, 400n);
    expect((await hct.getPublicState()).HCT__totalSupply).toBe(1000n);

    // Double-spend: Alice tries to spend her original note again -> rejected by
    // the nullifier set.
    await hct.privateState.set({
      secretKey: SK_A,
      inputNote: { value: 1000n, nonce: N1 },
      outNonce: N6,
      changeNonce: N7,
    });
    await expect(hct.transfer(PK_B, 100n)).rejects.toThrow('already spent');
  });

  it('rejects spending more than the note holds (conservation)', async () => {
    await hct.privateState.set({ outNonce: N1 });
    await hct.mint(PK_A, 500n);

    await hct.privateState.set({
      secretKey: SK_A,
      inputNote: { value: 500n, nonce: N1 },
      outNonce: N2,
      changeNonce: N3,
    });
    await expect(hct.transfer(PK_B, 600n)).rejects.toThrow('insufficient');
  });

  it('rejects a spend of a note not in the tree', async () => {
    // No mint; Alice claims a note that was never committed.
    await hct.privateState.set({
      secretKey: SK_A,
      inputNote: { value: 100n, nonce: N1 },
      outNonce: N2,
      changeNonce: N3,
    });
    await expect(hct.transfer(PK_B, 50n)).rejects.toThrow();
  });
});

describe('HybridConfidentialToken: regulated seizure', () => {
  beforeEach(async () => {
    hct = await HybridConfidentialTokenSimulator.create();
    await hct.privateState.set({ authoritySecret: SK_AUTH, outNonce: N1 });
    await hct.initializeAuthority(PK_AUTH);
  });

  it('authority seizes a note; owner is locked out; recovery is spendable', async () => {
    await hct.mint(PK_A, 1000n); // Alice's note (1000, N1)

    // Authority seizes Alice's note (learned via viewing) into the recovery pk.
    await hct.privateState.set({
      authoritySecret: SK_AUTH,
      inputNote: { value: 1000n, nonce: N1 },
      outNonce: N2, // recovery note nonce
    });
    await hct.seize(PK_A, PK_REC);
    expect((await hct.getPublicState()).HCT__seizureCount).toBe(1n);
    expect((await hct.getPublicState()).HCT__totalSupply).toBe(1000n); // conserved

    // Alice can no longer spend her note: the shared nullifier is already set.
    await hct.privateState.set({
      secretKey: SK_A,
      inputNote: { value: 1000n, nonce: N1 },
      outNonce: N3,
      changeNonce: N4,
    });
    await expect(hct.transfer(PK_B, 100n)).rejects.toThrow('already spent');

    // The recovery note (1000, N2) is spendable by the recovery owner.
    await hct.privateState.set({
      secretKey: SK_REC,
      inputNote: { value: 1000n, nonce: N2 },
      outNonce: N5,
      changeNonce: N6,
    });
    await hct.transfer(PK_B, 1000n); // succeeds => value recovered and usable
  });

  it('owner spending first makes seizure fail (mutual exclusion)', async () => {
    await hct.mint(PK_A, 500n);

    // Alice spends first.
    await hct.privateState.set({
      secretKey: SK_A,
      inputNote: { value: 500n, nonce: N1 },
      outNonce: N2,
      changeNonce: N3,
    });
    await hct.transfer(PK_B, 200n);

    // Authority now tries to seize the same (already-spent) note.
    await hct.privateState.set({
      authoritySecret: SK_AUTH,
      inputNote: { value: 500n, nonce: N1 },
      outNonce: N4,
    });
    await expect(hct.seize(PK_A, PK_REC)).rejects.toThrow('already spent');
  });

  it('a non-authority cannot seize', async () => {
    await hct.mint(PK_A, 300n);
    await hct.privateState.set({
      authoritySecret: bytes('IMPOSTOR_SK'),
      inputNote: { value: 300n, nonce: N1 },
      outNonce: N2,
    });
    await expect(hct.seize(PK_A, PK_REC)).rejects.toThrow('not the authority');
  });
});

describe('HybridConfidentialToken: auditor viewing', () => {
  const AUDIT_EK = 987654321n;
  const AUDIT_KEY = ecMulGenerator(AUDIT_EK);
  const DOMAIN = padTag('OZ:hybrid:audit');

  beforeEach(async () => {
    hct = await HybridConfidentialTokenSimulator.create();
    await hct.privateState.set({ outNonce: N1 });
    await hct.initializeAudit(AUDIT_KEY);
  });

  // The auditor decrypts every emitted viewing with its viewing secret; amounts
  // are otherwise hidden (values never leave a commitment/ciphertext).
  const auditorAmounts = async (): Promise<bigint[]> =>
    [...(await hct.getPublicState()).HCT__auditViewings].map((v) =>
      ecdhMask.decrypt(v, AUDIT_EK, DOMAIN),
    );

  it('auditor reads the amount of a mint', async () => {
    await hct.mint(PK_A, 1000n);
    expect(await auditorAmounts()).toContain(1000n);
  });

  it('auditor reads both output amounts of a private transfer', async () => {
    await hct.mint(PK_A, 1000n);
    await hct.privateState.set({
      secretKey: SK_A,
      inputNote: { value: 1000n, nonce: N1 },
      outNonce: N2,
      changeNonce: N3,
    });
    await hct.transfer(PK_B, 400n);

    // The auditor sees the transferred 400 and the change 600 (and the mint 1000).
    const amounts = await auditorAmounts();
    expect(amounts).toContain(400n);
    expect(amounts).toContain(600n);
    expect(amounts).toContain(1000n);
  });

  it('a wrong viewing key does not recover the amount', async () => {
    await hct.mint(PK_A, 1000n);
    const wrong = [...(await hct.getPublicState()).HCT__auditViewings].map((v) =>
      ecdhMask.decrypt(v, 111111n, DOMAIN),
    );
    expect(wrong).not.toContain(1000n);
  });
});
