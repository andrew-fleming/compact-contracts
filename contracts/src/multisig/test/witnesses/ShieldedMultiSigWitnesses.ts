// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * @description Interface defining the witness methods for ShieldedMultiSig operations.
 * @template P - The private state type.
 */
export interface IShieldedMultiSigWitnesses<L, P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  wit_ShieldedMultiSigSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description Represents the private state of a ShieldedMultiSig contract,
 * storing the secret key from which the caller's signer commitment is derived.
 */
export type ShieldedMultiSigPrivateState = {
  /** @description A 32-byte secret key used for deriving the signer commitment. */
  secretKey: Uint8Array;
};

/**
 * @description Utility object for managing the private state of a ShieldedMultiSig contract.
 */
export const ShieldedMultiSigPrivateState = {
  /**
   * @description Generates a new private state with a random secret key.
   * @returns A fresh ShieldedMultiSigPrivateState instance.
   */
  generate: (): ShieldedMultiSigPrivateState => {
    return { secretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret key.
   * Useful for deterministic key generation or advanced use cases.
   *
   * @param sk - The 32-byte secret key to use.
   * @returns A fresh ShieldedMultiSigPrivateState instance with the provided key.
   */
  withSecretKey: (sk: Uint8Array): ShieldedMultiSigPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Factory function creating witness implementations for ShieldedMultiSig operations.
 * @returns An object implementing the Witnesses interface for ShieldedMultiSigPrivateState.
 */
export const ShieldedMultiSigWitnesses = <L>(): IShieldedMultiSigWitnesses<
  L,
  ShieldedMultiSigPrivateState
> => ({
  wit_ShieldedMultiSigSK(
    context: WitnessContext<L, ShieldedMultiSigPrivateState>,
  ): [ShieldedMultiSigPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.secretKey),
    ];
  },
});
