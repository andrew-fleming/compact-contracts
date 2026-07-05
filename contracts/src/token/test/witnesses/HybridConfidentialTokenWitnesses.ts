// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives HybridConfidentialToken (notes) circuits in off-chain tests.

import { getRandomValues } from 'node:crypto';
import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockHybridConfidentialToken/contract/index.js';

export type Note = { value: bigint; nonce: Uint8Array };

export type HybridConfidentialTokenPrivateState = {
  /** Owner spend secret; pk = H(sk). */
  secretKey: Uint8Array;
  /** The input note being spent in a transfer. */
  inputNote: Note;
  /** Fresh nonce for the recipient output note. */
  outNonce: Uint8Array;
  /** Fresh nonce for the change output note. */
  changeNonce: Uint8Array;
  /** Seizure authority secret (authorityPk = H(authoritySecret)). */
  authoritySecret: Uint8Array;
  /** Seed for audit-viewing ephemerals. */
  randomnessSeed: Uint8Array;
};

export const HybridConfidentialTokenPrivateState = {
  generate: (): HybridConfidentialTokenPrivateState => ({
    secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    inputNote: { value: 0n, nonce: new Uint8Array(32) },
    outNonce: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    changeNonce: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    authoritySecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    randomnessSeed: new Uint8Array(32).fill(0x2a),
  }),
};

export interface IHybridConfidentialTokenWitnesses<P> {
  wit_SecretKey(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_InputNote(context: WitnessContext<Ledger, P>): [P, Note];
  wit_Path(
    context: WitnessContext<Ledger, P>,
    cm: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
  wit_OutNonce(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_ChangeNonce(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_AuthoritySecret(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_RandomnessSeed(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const HybridConfidentialTokenWitnesses =
  (): IHybridConfidentialTokenWitnesses<HybridConfidentialTokenPrivateState> => ({
    wit_SecretKey(context) {
      return [context.privateState, context.privateState.secretKey];
    },
    wit_InputNote(context) {
      return [context.privateState, context.privateState.inputNote];
    },
    // The circuit passes the input commitment; we return its Merkle path by
    // reading the live commitment tree from the ledger.
    wit_Path(context, cm) {
      const path = context.ledger.HCT__commitments.findPathForLeaf(cm);
      if (path === undefined) {
        throw new Error('wit_Path: commitment not found in tree');
      }
      return [context.privateState, path];
    },
    wit_OutNonce(context) {
      return [context.privateState, context.privateState.outNonce];
    },
    wit_ChangeNonce(context) {
      return [context.privateState, context.privateState.changeNonce];
    },
    wit_AuthoritySecret(context) {
      return [context.privateState, context.privateState.authoritySecret];
    },
    wit_RandomnessSeed(context) {
      return [context.privateState, context.privateState.randomnessSeed];
    },
  });
