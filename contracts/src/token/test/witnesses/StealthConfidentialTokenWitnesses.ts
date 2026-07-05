// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the StealthConfidentialToken circuits in off-chain tests. A production
// wallet must author and audit its own witnesses and return fresh, unpredictable
// randomness/ephemeral seeds per invocation.

import { getRandomValues } from 'node:crypto';
import type {
  JubjubPoint,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';

export const DEFAULT_RANDOMNESS_SEED: Uint8Array = new Uint8Array(32).fill(0x2a);

export type Ciphertext = { c1: JubjubPoint; c2: JubjubPoint };

function serializeCiphertext(ct: Ciphertext): string {
  return `${ct.c1.x.toString(16)}:${ct.c1.y.toString(16)}:${ct.c2.x.toString(16)}:${ct.c2.y.toString(16)}`;
}

export interface IStealthConfidentialTokenWitnesses<L, P> {
  wit_ScanSeed(context: WitnessContext<L, P>): [P, Uint8Array];
  wit_SpendSeed(context: WitnessContext<L, P>): [P, Uint8Array];
  wit_EphemeralSeed(context: WitnessContext<L, P>): [P, Uint8Array];
  wit_RandomnessSeed(context: WitnessContext<L, P>): [P, Uint8Array];
  wit_PlaintextBalance(
    context: WitnessContext<L, P>,
    ct: Ciphertext,
  ): [P, bigint];
}

export type StealthConfidentialTokenPrivateState = {
  /** Recipient scan seed (detects incoming stealth outputs). */
  scanSeed: Uint8Array;
  /** Recipient spend seed (authorizes spending one-time outputs). */
  spendSeed: Uint8Array;
  /** Sender per-payment ephemeral seed. */
  ephemeralSeed: Uint8Array;
  /** Balance-encryption randomness seed. */
  randomnessSeed: Uint8Array;
  /** Cached plaintexts, keyed by canonical ciphertext serialization. */
  plaintextCache: Map<string, bigint>;
};

export const StealthConfidentialTokenPrivateState = {
  generate: (): StealthConfidentialTokenPrivateState => ({
    scanSeed: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    spendSeed: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    ephemeralSeed: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    randomnessSeed: DEFAULT_RANDOMNESS_SEED,
    plaintextCache: new Map(),
  }),

  cachePlaintext: (
    state: StealthConfidentialTokenPrivateState,
    ct: Ciphertext,
    plaintext: bigint,
  ): StealthConfidentialTokenPrivateState => {
    const newCache = new Map(state.plaintextCache);
    newCache.set(serializeCiphertext(ct), plaintext);
    return { ...state, plaintextCache: newCache };
  },

  lookupPlaintext: (
    state: StealthConfidentialTokenPrivateState,
    ct: Ciphertext,
  ): bigint | undefined => {
    return state.plaintextCache.get(serializeCiphertext(ct));
  },
};

export const StealthConfidentialTokenWitnesses = <
  L,
>(): IStealthConfidentialTokenWitnesses<
  L,
  StealthConfidentialTokenPrivateState
> => ({
  wit_ScanSeed(context) {
    return [context.privateState, context.privateState.scanSeed];
  },
  wit_SpendSeed(context) {
    return [context.privateState, context.privateState.spendSeed];
  },
  wit_EphemeralSeed(context) {
    return [context.privateState, context.privateState.ephemeralSeed];
  },
  wit_RandomnessSeed(context) {
    return [context.privateState, context.privateState.randomnessSeed];
  },
  wit_PlaintextBalance(context, ct) {
    const plaintext = StealthConfidentialTokenPrivateState.lookupPlaintext(
      context.privateState,
      ct,
    );
    if (plaintext === undefined) {
      throw new Error(
        `wit_PlaintextBalance: no cached plaintext for ${serializeCiphertext(ct)}`,
      );
    }
    return [context.privateState, plaintext];
  },
});
